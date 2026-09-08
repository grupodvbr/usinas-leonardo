# Integrações

## ShinePhone / Growatt
A função `api/shinephone.mjs` usa `lib/connectors/shinephone.mjs`. Faz login no ShineServer e consulta lista de usinas, dados de planta e dispositivos.

## iSolarCloud / Sungrow
Usa OpenAPI V1:
- `/openapi/login`
- `/openapi/getPowerStationList`
- `/openapi/getDeviceList`
- `/openapi/getOpenPointInfo`
- `/openapi/getDeviceRealTimeData`

Necessário Developer Portal: APP_KEY + SECRET_KEY.

## elekeeper / SAJ
Usa Elekeeper Open Platform:
- `/open/api/access_token`
- `/open/api/developer/plant/page`
- `/open/api/plant/details`
- `/open/api/plant/getPlantStatisticsData`
- `/open/api/plant/getPlantAllDeviceList`

Necessário APP_ID + APP_SECRET e autorização da usina ao developer.

## SOLARMAN Smart
Usa OpenAPI:
- `/account/v1.0/token`
- `/station/v1.0/list`
- `/station/v1.0/realTime`

A senha é transformada em SHA-256 no servidor antes do token request. Necessário APP_ID + APP_SECRET.
