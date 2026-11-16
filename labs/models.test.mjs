import assert from 'node:assert/strict';
import {cohorts,pipeline,cash,batches} from './models.mjs';
for(let i=0;i<5;i++)assert.equal(cohorts.all[i],cohorts.inbound[i]+cohorts.outbound[i]);
for(const key of Object.keys(cohorts)){const p=pipeline(key,.5);assert.equal(p.forecast,cohorts[key][3]*.5);assert.equal(p.lost+p.stages[4],p.stages[0]);assert.ok(p.stages.every((v,i,a)=>!i||v<=a[i-1]));assert.equal(pipeline(key,0).forecast,0);assert.equal(pipeline(key,1).forecast,p.stages[3]);}
const baseline=cash();assert.equal(baseline.ccc,75);assert.ok(Math.abs(baseline.nwc-((12000000*45+7200000*60-7200000*30)/365))<1e-8);
assert.ok(Math.abs(baseline.nwc-cash({dso:44}).nwc-12000000/365)<1e-8);assert.ok(Math.abs(baseline.nwc-cash({dio:59}).nwc-7200000/365)<1e-8);assert.ok(Math.abs(baseline.nwc-cash({dpo:31}).nwc-7200000/365)<1e-8);
assert.equal(new Set(batches.map(b=>b.id)).size,batches.length);assert.ok(batches.every(b=>b.yield>=0&&b.yield<=100));console.log('Passed: cohort reconciliation, scenario endpoints, working capital identities, marginal day sensitivities, unique object IDs.');

for(const rate of [-1,1.1,NaN,Infinity])assert.throws(()=>pipeline('all',rate),RangeError);assert.throws(()=>pipeline('unknown'),RangeError);for(const field of ['revenue','cogs','dso','dio','dpo'])for(const v of [-1,NaN,Infinity,'45'])assert.throws(()=>cash({[field]:v}),RangeError);assert.equal(cash({revenue:0,cogs:0,dso:0,dio:0,dpo:0}).nwc,0);
