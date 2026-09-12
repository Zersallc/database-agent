/**
 * Column values in the rendered schema.
 *
 * The reader describes a category in their own words and the column holds a
 * particular spelling of it. Every case here is about the model being able to
 * see that spelling instead of reconstructing it, and about not overstating
 * what the list covers when it is only a sample.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderSchema } from "@/lib/agent/prompt";
import { looksLikeIdentifiers, namesPeople } from "@/lib/connectors/postgres";
import type { SchemaColumn, SchemaTable } from "@/lib/connectors";

function column(overrides: Partial<SchemaColumn> = {}): SchemaColumn {
  return {
    name: "HSE Observation SubClassification",
    data_type: "text",
    nullable: true,
    primary_key: false,
    description: null,
    ...overrides,
  };
}

function table(columns: SchemaColumn[]): SchemaTable[] {
  return [
    { schema: "public", name: "Observations DB", description: null, row_estimate: null, columns },
  ];
}

/**
 * What must never reach a prompt that is sent on every turn.
 *
 * These values are real shapes from the observations table. Query results
 * carrying contact details reach the model only when a question asked for them;
 * a schema hint carries them always, to every provider, into every log.
 */
describe("keeping contact details out of the schema", () => {
  test("a column of work email addresses is not a category", () => {
    assert.equal(
      looksLikeIdentifiers([
        "ctu2supervisor@intajllc.com",
        "ctu3supervisor@intajllc.com",
        "superintendent@intajllc.com",
      ]),
      true
    );
  });

  test("a column of phone numbers is not a category", () => {
    assert.equal(looksLikeIdentifiers(["96894968051", "+968 9496 8051"]), true);
  });

  test("a column of file paths is not a category", () => {
    assert.equal(
      looksLikeIdentifiers([
        "/appsheet/data/ISeeICare/Files/Certificate/one.pdf",
        "/appsheet/data/ISeeICare/Files/Certificate/two.pdf",
      ]),
      true
    );
  });

  test("the real hazard categories are kept", () => {
    assert.equal(
      looksLikeIdentifiers([
        "Health or Hygiene or Ergonomic Hazards",
        "Environmental (Spills, Waste, Emission etc.)",
        "Electrical Hazards",
      ]),
      false
    );
  });

  test("one address among many categories does not discard the column", () => {
    assert.equal(
      looksLikeIdentifiers(["Open", "Closed", "In Review", "Escalated", "someone@example.com"]),
      false
    );
  });
});

/**
 * Columns of people, recognised by name because nothing else can recognise
 * them. The cases that must NOT match are the point of the list: a denylist
 * that quietly swallows the categories this feature exists for has cost more
 * than it saved.
 */
describe("leaving columns of people alone", () => {
  for (const column of [
    "Name",
    "Full Name",
    "Employee Name",
    "Follow up by Management",
    "Responsible",
    "Created by",
    "Last Edited by",
    "Phone Number",
    "Email",
    "Contact Person",
    "Assignee",
    "Supervisor",
  ]) {
    test(`"${column}" is treated as people`, () => {
      assert.equal(namesPeople(column), true);
    });
  }

  for (const column of [
    "HSE Observation SubClassification",
    "HSE Observation Classification",
    "Status",
    "Category",
    "Unit",
    "Location1",
    "Department",
    "Hospital Name",
    "Engine Type",
  ]) {
    test(`"${column}" is still a category`, () => {
      assert.equal(namesPeople(column), false);
    });
  }
});

describe("rendering the values a column holds", () => {
  test("a complete list is offered as the set of values", () => {
    const rendered = renderSchema(
      table([
        column({
          distinct_values: {
            list: ["Health or Hygiene or Ergonomic Hazards", "Electrical Hazards"],
            complete: true,
          },
        }),
      ])
    );
    assert.match(rendered, /one of: 'Health or Hygiene or Ergonomic Hazards', 'Electrical Hazards'/);
  });

  test("a partial list never claims to be the whole set", () => {
    // Claiming completeness on a sample is worse than saying nothing: the model
    // rules out the value it should have gone looking for.
    const rendered = renderSchema(
      table([column({ distinct_values: { list: ["Electrical Hazards"], complete: false } })])
    );
    assert.match(rendered, /values include: 'Electrical Hazards'/);
    assert.doesNotMatch(rendered, /one of/);
  });

  test("the exact spelling reaches the prompt, punctuation and all", () => {
    // The real values carry commas and parentheses, and a mangled one is a
    // filter that matches nothing.
    const rendered = renderSchema(
      table([
        column({
          distinct_values: {
            list: ["Environmental (Spills, Waste, Emission etc.)"],
            complete: true,
          },
        }),
      ])
    );
    assert.ok(rendered.includes("Environmental (Spills, Waste, Emission etc.)"));
  });

  test("an apostrophe is escaped for the SQL the model will write", () => {
    const rendered = renderSchema(
      table([column({ distinct_values: { list: ["Driver's Hazards"], complete: true } })])
    );
    assert.ok(rendered.includes("'Driver''s Hazards'"));
  });

  test("a column without values renders exactly as it did before", () => {
    const rendered = renderSchema(table([column()]));
    assert.match(rendered, /- HSE Observation SubClassification: text$/m);
    assert.doesNotMatch(rendered, /one of|values include/);
  });

  test("an empty list is not rendered as an empty set", () => {
    const rendered = renderSchema(
      table([column({ distinct_values: { list: [], complete: true } })])
    );
    assert.doesNotMatch(rendered, /one of|values include/);
  });
});
