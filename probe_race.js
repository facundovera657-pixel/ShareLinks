const BASE = "https://sharelinks-pied.vercel.app/api/space";
let n = 0;
for (let round = 0; round < 8; round++) {
  const name = "Race" + Date.now().toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[+d]) + "ABCD".slice(0, 2);
  const uniq = (name + "qw" + round).slice(0, 12);
  const p = (body) => fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => r.status);
  const [a, b] = await Promise.all([p({ links: [], name: uniq }), p({ links: [], name: uniq })]);
  const codes = [a, b].sort().join(",");
  console.log(`round ${round} ${uniq}: [${codes}]`);
  if (codes !== "200,400") n++;
}
console.log("rondas malas:", n);
