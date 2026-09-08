import { providerHandler } from './_provider-handler.mjs';
export default {async fetch(request){return providerHandler(request,'elekeeper');}};
