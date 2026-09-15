/**
 * Reading the JSON-ish payloads the model writes into fenced blocks.
 *
 * The bug this exists for is silent and total: a ```chart whose option object
 * is written in JavaScript object-literal syntax — which is how every ECharts
 * example in the wild is written — failed `JSON.parse`, fell back to a plain
 * code block, and the reader got the option object printed at them instead of
 * the chart they asked for. Nothing threw; the answer just arrived as source.
 *
 * So the cases below are mostly about what the model actually writes, with the
 * payload from the original report reproduced verbatim.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asChartOption, parseRelaxedJson } from "@/components/chat/relaxed-json";

/** The exact block that rendered as text instead of a chart. */
const REPORTED = `{
  title: {
    text: 'Observations in August 2026 by Category'
  },
  tooltip: {
    trigger: 'axis',
    formatter: '{b}: {c}'
  },
  xAxis: {
    type: 'category',
    data: ['HSE Observation', 'Quality and CI Observation', 'Near Miss']
  },
  yAxis: {
    type: 'value'
  },
  series: [{
    name: 'Count',
    type: 'bar',
    data: [63, 46, 4],
    itemStyle: {
      color: '#5470C6'
    }
  }]
}`;

describe("parseRelaxedJson", () => {
  test("strict JSON parses as it always did", () => {
    assert.deepEqual(parseRelaxedJson('{"a": 1, "b": [true, false, null]}'), {
      a: 1,
      b: [true, false, null],
    });
  });

  test("the reported chart block parses to the option it always was", () => {
    const option = parseRelaxedJson<{
      title: { text: string };
      xAxis: { data: string[] };
      series: { data: number[]; itemStyle: { color: string } }[];
    }>(REPORTED);
    assert.ok(option, "the block that shipped as raw text has to parse");
    assert.equal(option.title.text, "Observations in August 2026 by Category");
    assert.deepEqual(option.xAxis.data, [
      "HSE Observation",
      "Quality and CI Observation",
      "Near Miss",
    ]);
    assert.deepEqual(option.series[0].data, [63, 46, 4]);
    assert.equal(option.series[0].itemStyle.color, "#5470C6");
  });

  test("braces and colons inside a string are text, not syntax", () => {
    // An ECharts formatter is full of them, and mis-scanning one would corrupt
    // every key after it.
    const parsed = parseRelaxedJson<{ tooltip: { formatter: string } }>(REPORTED);
    assert.equal(parsed?.tooltip.formatter, "{b}: {c}");
  });

  test("a quote of the other style survives inside a string", () => {
    assert.deepEqual(parseRelaxedJson(`{a: 'it"s', b: "it's"}`), {
      a: 'it"s',
      b: "it's",
    });
    assert.deepEqual(parseRelaxedJson(`{a: 'it\\'s fine'}`), { a: "it's fine" });
  });

  test("trailing commas are dropped", () => {
    assert.deepEqual(parseRelaxedJson(`{"a": [1, 2, 3,], "b": 4,}`), {
      a: [1, 2, 3],
      b: 4,
    });
  });

  test("comments are dropped", () => {
    const source = `{
      // the title
      title: {text: 'x'}, /* inline */
      series: [] // trailing
    }`;
    assert.deepEqual(parseRelaxedJson(source), { title: { text: "x" }, series: [] });
  });

  test("true, false and null stay literals rather than becoming strings", () => {
    assert.deepEqual(parseRelaxedJson(`{a: true, b: false, c: null}`), {
      a: true,
      b: false,
      c: null,
    });
  });

  test("escapes and unicode decode once, not twice", () => {
    assert.deepEqual(parseRelaxedJson(`{a: 'line\\nbreak', b: '\\u00e9', c: 'C:\\\\tmp'}`), {
      a: "line\nbreak",
      b: "é",
      c: "C:\\tmp",
    });
  });

  test("a half-streamed block still parses to null rather than half an object", () => {
    assert.equal(parseRelaxedJson(`{title: {text: 'Observ`), null);
  });

  test("something that is not an object at all is still null", () => {
    assert.equal(parseRelaxedJson("this was never JSON"), null);
  });
});

describe("asChartOption", () => {
  test("an ECharts option tagged `json` is recognized as a chart", () => {
    assert.ok(asChartOption(parseRelaxedJson(REPORTED)));
  });

  test("a result set is not a chart", () => {
    assert.equal(asChartOption({ columns: ["a"], rows: [[1]] }), null);
  });

  test("an option with no series draws nothing and is not claimed", () => {
    assert.equal(asChartOption({ title: { text: "x" }, series: [] }), null);
    assert.equal(asChartOption({ title: { text: "x" } }), null);
  });

  test("non-objects are not charts", () => {
    assert.equal(asChartOption(null), null);
    assert.equal(asChartOption([{ series: [1] }]), null);
    assert.equal(asChartOption("series"), null);
  });
});
