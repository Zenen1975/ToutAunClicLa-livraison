// Approved tariff in CAD cents. Round distance up by each additional 500 m;
// charge only complete 10-minute blocks of predicted congestion delay.
export function priceRoute({distanceMeters,durationSeconds,baselineSeconds}) {
  for(const n of [distanceMeters,durationSeconds,baselineSeconds])if(!Number.isFinite(n)||n<0)throw Error('Invalid route metrics');
  if(!Number.isSafeInteger(distanceMeters)||distanceMeters>40000000||durationSeconds>2592000||baselineSeconds>2592000)throw Error('Invalid route metrics');
  const extraDistanceBlocks=Math.ceil(Math.max(0,distanceMeters-3000)/500);
  const delaySeconds=Math.max(0,durationSeconds-baselineSeconds);
  const trafficBlocks=Math.floor(delaySeconds/600);
  const distanceCents=600+extraDistanceBlocks*50,trafficCents=trafficBlocks*250;
  return {currency:'CAD',distanceMeters,durationSeconds,baselineSeconds,delaySeconds,extraDistanceBlocks,trafficBlocks,
    distanceCents,trafficCents,totalCents:distanceCents+trafficCents};
}

export const TIP_OPTIONS=[0,500,800,1200,1700];
export function splitDeliveryPrice(totalCents,tipCents=0) {
  if(!Number.isSafeInteger(totalCents)||totalCents<0)throw Error('Invalid delivery price');
  if(!TIP_OPTIONS.includes(tipCents))throw Error('Invalid tip');
  const commissionCents=Math.round(totalCents*10/100);
  return {deliveryFareCents:totalCents,tipCents,totalPriceCents:totalCents+tipCents,commissionCents,driverPayoutCents:totalCents-commissionCents+tipCents};
}
