import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  selectStockAnalysisTargets,
  isAnalyzableSymbol,
  STOCK_ANALYSIS_MAX_TARGETS,
  STOCK_ANALYSIS_MIN_TARGETS,
} from '../src/services/stock-analysis-targets.ts';

const DEFAULTS = [
  { symbol: 'AAPL', name: 'Apple', display: 'AAPL' },
  { symbol: 'MSFT', name: 'Microsoft', display: 'MSFT' },
  { symbol: 'NVDA', name: 'NVIDIA', display: 'NVDA' },
  { symbol: 'GOOGL', name: 'Alphabet', display: 'GOOGL' },
  { symbol: 'AMZN', name: 'Amazon', display: 'AMZN' },
  { symbol: '^GSPC', name: 'S&P 500', display: 'SPX' },
  { symbol: 'GC=F', name: 'Gold', display: 'GOLD' },
];

const symbolsOf = (targets: Array<{ symbol: string }>) => targets.map((t) => t.symbol);

describe('isAnalyzableSymbol', () => {
  it('rejects indices and FX/futures, accepts ordinary equities', () => {
    assert.equal(isAnalyzableSymbol('^GSPC'), false);
    assert.equal(isAnalyzableSymbol('EURUSD=X'), false);
    assert.equal(isAnalyzableSymbol('GC=F'), false);
    assert.equal(isAnalyzableSymbol('AAPL'), true);
    assert.equal(isAnalyzableSymbol('BRK-B'), true);
    assert.equal(isAnalyzableSymbol('RELIANCE.NS'), true);
  });
});

describe('selectStockAnalysisTargets', () => {
  it('empty watchlists fall back to the first default analysable targets', () => {
    const targets = selectStockAnalysisTargets([], DEFAULTS);
    assert.deepEqual(symbolsOf(targets), ['AAPL', 'MSFT', 'NVDA', 'GOOGL']);
  });

  it('uses the whole supported watchlist up to the shared operational cap', () => {
    const watchlist = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((symbol) => ({ symbol }));
    const targets = selectStockAnalysisTargets(watchlist, DEFAULTS);
    assert.equal(targets.length, watchlist.length);
    assert.deepEqual(symbolsOf(targets), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  });

  it('REGRESSION: a single watchlist entry never collapses the panel to one ticker', () => {
    // This is the original "tracking only one ticker" bug: adding one ticker
    // used to REPLACE the defaults. It must now be ADDITIVE.
    const targets = selectStockAnalysisTargets([{ symbol: 'TSLA' }], DEFAULTS);
    assert.equal(targets.length, STOCK_ANALYSIS_MIN_TARGETS, 'should top up to the shared floor, not collapse to 1');
    assert.equal(targets[0]?.symbol, 'TSLA', 'the user pick leads');
    assert.deepEqual(symbolsOf(targets), ['TSLA', 'AAPL', 'MSFT', 'NVDA']);
  });

  it('watchlists larger than the default floor use the user list as-is', () => {
    const watchlist = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']
      .map((symbol) => ({ symbol }));
    const targets = selectStockAnalysisTargets(watchlist, DEFAULTS);
    assert.equal(targets.length, 10);
    assert.deepEqual(symbolsOf(targets), watchlist.map((e) => e.symbol));
  });

  it('watchlists are capped at the shared operational limit', () => {
    const watchlist = Array.from({ length: 60 }, (_, i) => ({ symbol: `SYM${i}` }));
    const targets = selectStockAnalysisTargets(watchlist, DEFAULTS);
    assert.equal(targets.length, STOCK_ANALYSIS_MAX_TARGETS);
    assert.equal(targets[0]?.symbol, 'SYM0');
    assert.equal(targets[STOCK_ANALYSIS_MAX_TARGETS - 1]?.symbol, `SYM${STOCK_ANALYSIS_MAX_TARGETS - 1}`);
  });

  it('drops non-analysable watchlist entries but still tops up — an index-only watchlist never breaks the panel', () => {
    const targets = selectStockAnalysisTargets(
      [{ symbol: '^GSPC' }, { symbol: 'EURUSD=X' }],
      DEFAULTS,
    );
    assert.deepEqual(symbolsOf(targets), ['AAPL', 'MSFT', 'NVDA', 'GOOGL']);
  });

  it('mixes analysable picks with the top-up and de-dupes against the defaults', () => {
    // NVDA appears in both the watchlist and DEFAULTS — it must appear once,
    // in the user-pick position.
    const targets = selectStockAnalysisTargets(
      [{ symbol: 'TSLA' }, { symbol: '^GSPC' }, { symbol: 'NVDA' }],
      DEFAULTS,
    );
    assert.deepEqual(symbolsOf(targets), ['TSLA', 'NVDA', 'AAPL', 'MSFT']);
  });

  it('falls back to the symbol for missing name/display', () => {
    const [target] = selectStockAnalysisTargets([{ symbol: 'TSLA' }], []);
    assert.deepEqual(target, { symbol: 'TSLA', name: 'TSLA', display: 'TSLA' });
  });

  it('preserves friendly name/display labels from the watchlist entry', () => {
    const [target] = selectStockAnalysisTargets(
      [{ symbol: 'TSLA', name: 'Tesla', display: 'TSLA' }],
      [],
    );
    assert.deepEqual(target, { symbol: 'TSLA', name: 'Tesla', display: 'TSLA' });
  });

  it('limitOverride can shrink the resolved cap (keeps dependent fetches aligned)', () => {
    const watchlist = Array.from({ length: 10 }, (_, i) => ({ symbol: `SYM${i}` }));
    const targets = selectStockAnalysisTargets(watchlist, DEFAULTS, { limitOverride: 3 });
    assert.equal(targets.length, 3);
  });

  it('limitOverride cannot grow past the shared cap', () => {
    const targets = selectStockAnalysisTargets([], DEFAULTS, { limitOverride: 20 });
    assert.equal(targets.length, STOCK_ANALYSIS_MIN_TARGETS);
  });
});
