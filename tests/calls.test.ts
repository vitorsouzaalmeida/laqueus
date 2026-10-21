import { describe, expect, it } from "vitest";
import { analyzeCode } from "./helpers";

const callPairs = (fileName: string, code: string) => {
  const analysis = analyzeCode(fileName, code);
  const name = (id: string) => analysis.functions.find((fn) => fn.id === id)?.name ?? id;

  return analysis.calls.map((edge) => `${name(edge.from)} -> ${name(edge.to)}`).toSorted();
};

describe("local call resolution", () => {
  const code = `
import { imported } from "./other";
declare const obj: { method(): void };
declare const key: "method";

function a() {
  b();
  helper();
  imported();
  obj.method();
  obj[key]();
  b();
}
function b() {
  return 1;
}
const helper = () => {
  const b = () => 2;
  return b();
};
function withParam(cb: () => void) {
  cb();
}
function outer() {
  function inner() {
    return b();
  }
  return inner();
}
[1].forEach(() => b());
let reassigned = () => 1;
reassigned = () => 2;
function usesReassigned() {
  reassigned();
}
class Service {
  run() {
    this.step();
    this.missing();
    const later = () => this.step();
    function detached(this: unknown) {
      (this as Service).step();
    }
    return [later, detached];
  }
  step() {}
  static make() {
    this.build();
    this.step();
  }
  static build() {}
}
`;

  it("only draws provable same-file calls", () => {
    expect(callPairs("calls.ts", code)).toEqual([
      "Service.make -> Service.build",
      "Service.run -> Service.step",
      "a -> b",
      "a -> helper",
      "forEach callback -> b",
      "helper -> b",
      "inner -> b",
      "later -> Service.step",
      "outer -> inner",
    ]);
  });

  it("resolves a shadowed name to the inner binding", () => {
    const analysis = analyzeCode("calls.ts", code);
    const innerB = analysis.functions.find((fn) => fn.name === "b" && fn.location.line === 18);
    const helper = analysis.functions.find((fn) => fn.name === "helper");

    expect(analysis.calls).toContainEqual(expect.objectContaining({ from: helper?.id, to: innerB?.id }));
  });

  it("groups repeated call sites into one edge", () => {
    const analysis = analyzeCode("calls.ts", code);
    const a = analysis.functions.find((fn) => fn.name === "a");
    const outerB = analysis.functions.find((fn) => fn.name === "b" && fn.location.line === 14);
    const edge = analysis.calls.find((call) => call.from === a?.id && call.to === outerB?.id);

    expect(edge?.occurrences.map((location) => location.line)).toEqual([7, 12]);
  });

  it("ignores Svelte template references and calls", () => {
    expect(
      callPairs(
        "Page.svelte",
        `<script lang="ts">
  function save() {
    persist();
  }
  function persist() {}
</script>
<button onclick={save}>Save</button>
<button onclick={() => persist()}>Persist</button>
<p>{persist()}</p>`,
      ),
    ).toEqual(["save -> persist"]);
  });

  it("does not resolve calls to imported functions in Svelte scripts", () => {
    expect(
      callPairs(
        "Widget.svelte",
        `<script>
  import { format } from "./format";
  const show = () => format(1);
</script>`,
      ),
    ).toEqual([]);
  });
});
