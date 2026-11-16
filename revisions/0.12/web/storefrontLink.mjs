export function storefrontLink(slug, origin = 'https://pitacco.com.br') {
  return /^[a-z0-9][a-z0-9-]{2,59}$/.test(slug ?? '') ? origin.replace(/\/$/, '') + '/' + slug : '';
}
