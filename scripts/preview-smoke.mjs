const baseURL = process.env.MINTLIFY_PREVIEW_URL?.trim();

if (!baseURL) {
  console.log('SKIP: MINTLIFY_PREVIEW_URL is not configured');
  process.exit(0);
}

const llmsResponse = await fetch(new URL('/llms.txt', baseURL));
if (!llmsResponse.ok) {
  throw new Error(`Preview llms.txt returned ${llmsResponse.status}`);
}
const llmsText = await llmsResponse.text();
if (llmsText.includes('Plant Store') || !llmsText.includes('AMA2')) {
  throw new Error('Preview llms.txt still looks like placeholder content');
}

const openapiResponse = await fetch(new URL('/api-reference/openapi.json', baseURL));
if (!openapiResponse.ok) {
  throw new Error(`Preview api-reference/openapi.json returned ${openapiResponse.status}`);
}
const openapi = await openapiResponse.json();
const title = String(openapi?.info?.title ?? '');
const paths = Object.keys(openapi?.paths ?? {});
if (title.includes('Plant Store') || paths.includes('/plants')) {
  throw new Error('Preview OpenAPI surface still contains placeholder content');
}
if (!paths.includes('/api/v1/chat/threads')) {
  throw new Error('Preview OpenAPI surface is missing AMA2 public runtime paths');
}

console.log('PASS: Mintlify preview smoke passed');
