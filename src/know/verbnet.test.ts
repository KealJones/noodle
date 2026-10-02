import assert from "node:assert/strict";
import { test } from "node:test";
import { key } from "../runtime/expr.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import { seededStore } from "../runtime/seed.js";
import { importVerbNet } from "./verbnet.js";

// An invented class in VerbNet 3.4's shape (event semantics, cause between events).
const PUT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE VNCLASS SYSTEM "vn_class-3.dtd">
<VNCLASS ID="put-9.1">
  <MEMBERS>
    <MEMBER name="put" wn="put%2:35:00" grouping="put.01"/>
    <MEMBER name="place" wn="place%2:35:00" grouping=""/>
  </MEMBERS>
  <THEMROLES><THEMROLE type="Agent"/><THEMROLE type="Theme"/><THEMROLE type="Destination"/></THEMROLES>
  <FRAMES>
    <FRAME>
      <DESCRIPTION descriptionNumber="0.2" primary="NP V NP PP.destination" secondary="" xtag=""/>
      <EXAMPLES><EXAMPLE>I put the book on the table.</EXAMPLE></EXAMPLES>
      <SYNTAX>
        <NP value="Agent"><SYNRESTRS/></NP>
        <VERB/>
        <NP value="Theme"><SYNRESTRS/></NP>
        <PREP><SELRESTRS><SELRESTR Value="+" type="loc"/></SELRESTRS></PREP>
        <NP value="Destination"><SYNRESTRS/></NP>
      </SYNTAX>
      <SEMANTICS>
        <PRED value="has_location"><ARGS><ARG type="Event" value="e1"/><ARG type="ThemRole" value="Theme"/><ARG type="ThemRole" value="?Initial_Location"/></ARGS></PRED>
        <PRED value="do"><ARGS><ARG type="Event" value="e2"/><ARG type="ThemRole" value="Agent"/></ARGS></PRED>
        <PRED value="motion"><ARGS><ARG type="Event" value="e3"/><ARG type="ThemRole" value="Theme"/></ARGS></PRED>
        <PRED bool="!" value="has_location"><ARGS><ARG type="Event" value="e3"/><ARG type="ThemRole" value="Theme"/><ARG type="ThemRole" value="Destination"/></ARGS></PRED>
        <PRED value="has_location"><ARGS><ARG type="Event" value="e4"/><ARG type="ThemRole" value="Theme"/><ARG type="ThemRole" value="Destination"/></ARGS></PRED>
        <PRED value="cause"><ARGS><ARG type="Event" value="e2"/><ARG type="Event" value="e4"/></ARGS></PRED>
      </SEMANTICS>
    </FRAME>
    <FRAME>
      <DESCRIPTION primary="NP V S" secondary=""/>
      <SYNTAX><NP value="Agent"/><VERB/><S value="Topic"/></SYNTAX>
      <SEMANTICS/>
    </FRAME>
  </FRAMES>
  <SUBCLASSES/>
</VNCLASS>`;

test("VerbNet frames give verbs chart entries and readings that reach the bridge", () => {
  const store = seededStore();
  const r = importVerbNet([{ name: "put-9.1.xml", xml: PUT }], store, { version: "3.4" });
  assert.equal(r.frames, 1);
  assert.equal(r.skippedFrames, 1);
  store.load(r.text);
  const entries = store.facts("Put", "Category");
  assert.equal(entries.length, 1);
  assert.match(key(entries[0].claim), /Takes\(category=Relation\(\), role=Destination\(\), side=Right\(\)\)/);
  // "put the plan in my list", heard: Put(agent, theme, destination) reduces to core meanings and
  // meets the bridge at Store.
  const heard = store.readingsOn("Put")[0].pattern;
  const rw = new Rewriter(store, new Weights(store).get);
  // Rewriting keeps alternatives; stage two picks among them. Store must be one of them.
  const lfs = rw.normalize(heard).map((d) => key(d.expr));
  assert.ok(lfs.some((x) => x.startsWith("Store($destination, $theme")), lfs.join("\n"));
});
