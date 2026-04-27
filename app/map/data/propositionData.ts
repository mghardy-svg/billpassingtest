export interface CountyVotes {
  [fips: string]: number; // % yes
}

export interface Proposition {
  id: string;
  label: string;
  shortLabel: string;
  desc: string;
  passed: boolean;
  statewidePct: number;
}

export const PROPOSITIONS: Proposition[] = [
  { id: "P1",  label: "Prop 1 – Abortion Rights",    shortLabel: "Prop 1",  desc: "Constitutional right to abortion and contraception",               passed: true,  statewidePct: 67 },
  { id: "P26", label: "Prop 26 – Sports Betting",    shortLabel: "Prop 26", desc: "In-person sports betting at tribal casinos",                        passed: false, statewidePct: 48 },
  { id: "P27", label: "Prop 27 – Online Betting",    shortLabel: "Prop 27", desc: "Online and mobile sports wagering statewide",                       passed: false, statewidePct: 17 },
  { id: "P28", label: "Prop 28 – Arts Education",    shortLabel: "Prop 28", desc: "Dedicated funding for arts and music in public schools",             passed: true,  statewidePct: 58 },
  { id: "P29", label: "Prop 29 – Dialysis Clinics",  shortLabel: "Prop 29", desc: "New requirements for kidney dialysis clinics",                      passed: false, statewidePct: 37 },
  { id: "P30", label: "Prop 30 – EV Funding",        shortLabel: "Prop 30", desc: "EV charging infrastructure via tax on high earners",                passed: false, statewidePct: 41 },
];

export const CA_COUNTIES: { [fips: string]: string } = {
  "06001":"Alameda","06003":"Alpine","06005":"Amador","06007":"Butte","06009":"Calaveras",
  "06011":"Colusa","06013":"Contra Costa","06015":"Del Norte","06017":"El Dorado","06019":"Fresno",
  "06021":"Glenn","06023":"Humboldt","06025":"Imperial","06027":"Inyo","06029":"Kern",
  "06031":"Kings","06033":"Lake","06035":"Lassen","06037":"Los Angeles","06039":"Madera",
  "06041":"Marin","06043":"Mariposa","06045":"Mendocino","06047":"Merced","06049":"Modoc",
  "06051":"Mono","06053":"Monterey","06055":"Napa","06057":"Nevada","06059":"Orange",
  "06061":"Placer","06063":"Plumas","06065":"Riverside","06067":"Sacramento","06069":"San Benito",
  "06071":"San Bernardino","06073":"San Diego","06075":"San Francisco","06077":"San Joaquin",
  "06079":"San Luis Obispo","06081":"San Mateo","06083":"Santa Barbara","06085":"Santa Clara",
  "06087":"Santa Cruz","06089":"Shasta","06091":"Sierra","06093":"Siskiyou","06095":"Solano",
  "06097":"Sonoma","06099":"Stanislaus","06101":"Sutter","06103":"Tehama","06105":"Trinity",
  "06107":"Tulare","06109":"Tuolumne","06111":"Ventura","06113":"Yolo","06115":"Yuba",
};

// Sample vote data — replace with real results
// Urban counties trend higher yes, rural lower, with per-prop variation
const URBAN_FIPS = new Set([
  "06037","06075","06085","06013","06001","06073","06059","06081","06067","06041","06097","06055"
]);

function generate(propId: string, base: number, seed: number): CountyVotes {
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const result: CountyVotes = {};
  Object.keys(CA_COUNTIES).forEach(fips => {
    const urban = URBAN_FIPS.has(fips);
    const adj = urban ? base + 7 : base - 4;
    const pct = Math.min(97, Math.max(3, Math.round(adj + (rng() - 0.5) * 22)));
    result[fips] = pct;
  });
  return result;
}

export const VOTE_DATA: { [propId: string]: CountyVotes } = {
  P1:  generate("P1",  67, 1001),
  P26: generate("P26", 48, 2607),
  P27: generate("P27", 17, 2737),
  P28: generate("P28", 58, 2837),
  P29: generate("P29", 37, 2947),
  P30: generate("P30", 41, 3037),
};
