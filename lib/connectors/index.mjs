import { getShinePhoneData } from './shinephone.mjs';
import { getISolarCloudData } from './isolarcloud.mjs';
import { getElekeeperData } from './elekeeper.mjs';
import { getSolarmanData } from './solarman.mjs';
export async function getProviderData(item){
  if(item.app_id==='shinephone')return getShinePhoneData(item);
  if(item.app_id==='isolarcloud')return getISolarCloudData(item);
  if(item.app_id==='elekeeper')return getElekeeperData(item);
  if(item.app_id==='solarman')return getSolarmanData(item);
  throw new Error('Plataforma não suportada.');
}
