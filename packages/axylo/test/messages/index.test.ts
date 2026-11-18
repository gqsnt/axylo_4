import { expect, it } from 'vitest';
import type { Messages } from '../../src/public';
import { defaultMessages, fill, resolveMessages } from '../../src/messages';

it('gives every public message a non-empty default', () => {
  const keys: Record<keyof Messages, true> = {
    viewAsTable: true, hideTable: true, noData: true, noObservation: true, incompleteStack: true,
    moreRows: true, otherSlices: true, valuesNotShown: true, valuesChanged: true, labelsHidden: true,
    loading: true, empty: true, error: true, internalError: true,
    chartName: true, chartSummary: true, seriesSummary: true, referenceSummary: true, timeZoneNote: true,
    plotLabel: true, controlsLabel: true, pointOf: true,
    zoomIn: true, zoomOut: true, resetZoom: true, pause: true, resume: true,
    category: true, percentage: true, series: true, value: true,
    typeLine: true, typeArea: true, typeBar: true, typeScatter: true, typeDonut: true,
    plotRole: true, pointAll: true, seriesValue: true, position: true, total: true,
    panLeft: true, panRight: true, jumpNotFound: true, plotInstructions: true, seeTable: true,
    donutSummary: true, seriesNoData: true, seriesNotDrawn: true, referenceLine: true, referenceBand: true,
    previousPage: true, nextPage: true, pageOf: true, jumpToX: true, showSeries: true, hideSeries: true,
  };
  expect(Object.keys(defaultMessages).sort()).toEqual(Object.keys(keys).sort());
  for (const text of Object.values(defaultMessages)) expect(text.trim()).not.toBe('');
});

it('fills templates once, preserving unknown names and literal braces and dollar signs in values', () => {
  expect(fill('{series} at {index} ({series}) {missing} {toString}', { series: '{index} $&', index: 2 }))
    .toBe('{index} $& at 2 ({index} $&) {missing} {toString}');
});

it('includes the table guidance placeholder in all four default templates', () => {
  expect(defaultMessages).toMatchObject({
    valuesNotShown: 'Values not shown: {count}. {seeTable}',
    valuesChanged: 'Values shown differently from the data: {count}. {seeTable}',
    labelsHidden: 'Some labels hidden. {seeTable}',
    seriesNotDrawn: '{series} could not be drawn. {seeTable}',
    seeTable: 'See table.',
  });
});

it('replaces individual messages without changing defaults or copying undefined', () => {
  const messages = resolveMessages({ noData: 'Keine Daten', loading: undefined });
  expect(messages).toEqual({ ...defaultMessages, noData: 'Keine Daten' });
  expect(defaultMessages.noData).toBe('No data');
  expect(fill(messages.moreRows, { count: 3 })).toBe('+3 more');
});
