// NonInvestor Cloudflare Worker
// Deploy at: dash.cloudflare.com -> Workers & Pages -> Create Worker
// Then paste this entire file
// Add these Environment Variables in Worker Settings -> Variables:
//   DEEPSEEK_API_KEY  = your DeepSeek key (free at platform.deepseek.com)
//   FINNHUB_API_KEY   = d80t0h1r01qler4g57kgd80t0h1r01qler4g57l0

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: CORS });
}

function err(msg, status) {
  return json({ error: msg }, status || 500);
}

// ── YAHOO FINANCE QUOTE ──────────────────────────────────────────────────────
async function yahooQuote(symbol) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?interval=1d&range=1d&includePrePost=false';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) throw new Error('Yahoo status ' + res.status);
    const data = await res.json();
    const result = data.chart && data.chart.result && data.chart.result[0];
    if (!result) throw new Error('No result from Yahoo');
    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const changeAmt = price - prevClose;
    const changePct = prevClose ? (changeAmt / prevClose) * 100 : 0;
    return {
      symbol: meta.symbol,
      price: price,
      change: changeAmt,
      changePercent: changePct,
      previousClose: prevClose,
      high52: meta.fiftyTwoWeekHigh,
      low52: meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
      marketCap: meta.marketCap,
      currency: meta.currency || 'USD',
      exchangeName: meta.exchangeName || '',
      source: 'yahoo',
    };
  } catch (e) {
    return null;
  }
}

// ── YAHOO FINANCE HISTORICAL (for sparkline) ─────────────────────────────────
async function yahooHistory(symbol, range) {
  try {
    const r = range || '5d';
    const interval = r === '1d' ? '5m' : '1d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?interval=' + interval + '&range=' + r;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Yahoo history fail');
    const data = await res.json();
    const result = data.chart && data.chart.result && data.chart.result[0];
    if (!result) throw new Error('No result');
    const closes = result.indicators &&
      result.indicators.quote &&
      result.indicators.quote[0] &&
      result.indicators.quote[0].close;
    const timestamps = result.timestamp || [];
    const points = [];
    if (closes) {
      closes.forEach(function(c, i) {
        if (c !== null && c !== undefined) {
          points.push({ t: timestamps[i] || i, v: parseFloat(c.toFixed(4)) });
        }
      });
    }
    return points;
  } catch (e) {
    return [];
  }
}

// ── COINGECKO CRYPTO ─────────────────────────────────────────────────────────
const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
  UNI: 'uniswap', LTC: 'litecoin', ATOM: 'cosmos', NEAR: 'near',
  APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', TRX: 'tron',
};

async function cryptoPrice(symbol) {
  try {
    const id = COINGECKO_IDS[symbol.toUpperCase()];
    if (!id) throw new Error('Unknown crypto symbol');
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + id +
      '&order=market_cap_desc&per_page=1&page=1&sparkline=false&price_change_percentage=24h';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('CoinGecko fail ' + res.status);
    const data = await res.json();
    if (!data || !data[0]) throw new Error('No data');
    const coin = data[0];
    return {
      symbol: symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change: coin.price_change_24h,
      changePercent: coin.price_change_percentage_24h,
      high52: coin.high_24h,
      low52: coin.low_24h,
      volume: coin.total_volume,
      marketCap: coin.market_cap,
      currency: 'USD',
      source: 'coingecko',
    };
  } catch (e) {
    return null;
  }
}

// ── YAHOO SEARCH ──────────────────────────────────────────────────────────────
async function yahooSearch(query) {
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(query) +
      '&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=true&enableCb=false';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) throw new Error('Search fail');
    const data = await res.json();
    const quotes = data.quotes || [];
    const results = quotes
      .filter(function(q) { return q.symbol && q.shortname; })
      .map(function(q) {
        let type = 'stock';
        const qt = (q.quoteType || '').toLowerCase();
        if (qt === 'cryptocurrency') type = 'crypto';
        else if (qt === 'etf') type = 'etf';
        else if (qt === 'mutualfund') type = 'etf';
        else if (qt === 'index') type = 'index';
        return {
          symbol: q.symbol,
          name: q.shortname || q.longname || q.symbol,
          type: type,
          exchange: q.exchange || '',
          sector: q.sector || '',
        };
      });
    return results;
  } catch (e) {
    return [];
  }
}

// ── FINNHUB QUOTE (fallback) ──────────────────────────────────────────────────
async function finnhubQuote(symbol, apiKey) {
  try {
    const url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol) +
      '&token=' + apiKey;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Finnhub fail');
    const d = await res.json();
    if (!d || d.c === 0) throw new Error('No data');
    const changePct = d.pc ? ((d.c - d.pc) / d.pc) * 100 : 0;
    return {
      symbol: symbol,
      price: d.c,
      change: d.d || (d.c - d.pc),
      changePercent: d.dp || changePct,
      high52: d.h,
      low52: d.l,
      previousClose: d.pc,
      source: 'finnhub',
    };
  } catch (e) {
    return null;
  }
}

// ── DEEPSEEK AI ───────────────────────────────────────────────────────────────
async function deepseekAI(prompt, apiKey) {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 180,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error('DeepSeek fail ' + res.status);
    const d = await res.json();
    return d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content
      ? d.choices[0].message.content.trim()
      : '';
  } catch (e) {
    return '';
  }
}

// ── ROUTE HANDLER ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const FINNHUB_KEY = (env && env.FINNHUB_API_KEY) || 'd80t0h1r01qler4g57kgd80t0h1r01qler4g57l0';
    const DEEPSEEK_KEY = (env && env.DEEPSEEK_API_KEY) || '';

    // ── /quote?symbol=AAPL ──────────────────────────────────────────────────
    if (path === '/quote') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return err('symbol required', 400);

      let data = await yahooQuote(symbol);
      if (!data || !data.price) {
        data = await finnhubQuote(symbol, FINNHUB_KEY);
      }
      if (!data) return err('Could not fetch quote for ' + symbol, 404);
      return json(data);
    }

    // ── /quotes?symbols=AAPL,MSFT,TSLA ──────────────────────────────────────
    if (path === '/quotes') {
      const raw = url.searchParams.get('symbols') || '';
      const symbols = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean).slice(0, 20);
      if (!symbols.length) return err('symbols required', 400);

      const results = {};
      await Promise.allSettled(symbols.map(async function(sym) {
        let d = await yahooQuote(sym);
        if (!d || !d.price) d = await finnhubQuote(sym, FINNHUB_KEY);
        if (d) results[sym] = d;
      }));
      return json(results);
    }

    // ── /crypto?symbol=BTC ──────────────────────────────────────────────────
    if (path === '/crypto') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return err('symbol required', 400);
      const data = await cryptoPrice(symbol);
      if (!data) return err('Could not fetch crypto for ' + symbol, 404);
      return json(data);
    }

    // ── /cryptos?symbols=BTC,ETH,SOL ────────────────────────────────────────
    if (path === '/cryptos') {
      const raw = url.searchParams.get('symbols') || '';
      const symbols = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      const results = {};
      await Promise.allSettled(symbols.map(async function(sym) {
        const d = await cryptoPrice(sym);
        if (d) results[sym] = d;
      }));
      return json(results);
    }

    // ── /history?symbol=AAPL&range=5d ───────────────────────────────────────
    if (path === '/history') {
      const symbol = url.searchParams.get('symbol');
      const range = url.searchParams.get('range') || '5d';
      if (!symbol) return err('symbol required', 400);
      const points = await yahooHistory(symbol, range);
      return json({ symbol: symbol, range: range, points: points });
    }

    // ── /search?q=apple ─────────────────────────────────────────────────────
    if (path === '/search') {
      const q = url.searchParams.get('q');
      if (!q) return err('q required', 400);
      const results = await yahooSearch(q);
      return json({ results: results });
    }

    // ── /ai?prompt=... ───────────────────────────────────────────────────────
    if (path === '/ai') {
      const prompt = url.searchParams.get('prompt');
      if (!prompt) return err('prompt required', 400);
      if (!DEEPSEEK_KEY) {
        return json({ response: 'AI unavailable: DEEPSEEK_API_KEY not set in Worker environment variables.' });
      }
      const response = await deepseekAI(prompt, DEEPSEEK_KEY);
      return json({ response: response });
    }

    // ── /health ──────────────────────────────────────────────────────────────
    if (path === '/health') {
      return json({ status: 'ok', worker: 'noninvestor-v2', ts: Date.now() });
    }

    return err('Not found. Valid routes: /quote /quotes /crypto /cryptos /history /search /ai /health', 404);
  }
};
