// A shared signed domain keeps every value proportional and zero visible.
export function signedScale(values){
 if(!values.length||!values.every(Number.isFinite))throw new RangeError('Chart requires finite values');
 const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
 const position=value=>(value-low)/span*100;
 return {low,high,zero:position(0),bars:values.map(value=>({left:position(Math.min(0,value)),width:Math.abs(value)/span*100}))};
}
