import assert from 'node:assert/strict';
import {signedScale} from './signed-scale.mjs';
import {cash} from './models.mjs';
for(const dso of [15,75])for(const dio of [20,100])for(const dpo of [10,75]){
 const c=cash({dso,dio,dpo}),values=[c.ar,c.inventory,-c.ap,c.nwc],scale=signedScale(values);
 assert.ok(scale.zero>=0&&scale.zero<=100);
 scale.bars.forEach((bar,i)=>{assert.ok(bar.left>=-1e-10);assert.ok(bar.width>=0);assert.ok(bar.left+bar.width<=100+1e-10);assert.ok(Math.abs(bar.width/100*(scale.high-scale.low)-Math.abs(values[i]))<1e-8);if(values[i]<0)assert.ok(Math.abs(bar.left+bar.width-scale.zero)<1e-10);});
}
const negative=cash({dso:15,dio:20,dpo:75});assert.ok(negative.nwc<0);assert.ok(signedScale([negative.nwc]).bars[0].width>0);
assert.equal(signedScale([0,0]).bars[0].width,0);assert.throws(()=>signedScale([NaN]),RangeError);
console.log('Passed signed chart scaling across all eight lever extremes, negative NWC visibility, zero and invalid values.');
