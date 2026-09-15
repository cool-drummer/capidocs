import type { Spec } from '@capidocs/spec';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
type Method = (typeof METHODS)[number];
type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveRef(root: Json, ref: string): Json | null {
  if (!ref.startsWith('#/')) return null;
  const target = ref
    .slice(2)
    .split('/')
    .reduce<unknown>((acc, part) => (isJson(acc) ? acc[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), root);
  return isJson(target) ? target : null;
}

function deref(root: Json, value: unknown): Json {
  if (isJson(value) && typeof value.$ref === 'string') return resolveRef(root, value.$ref) ?? {};
  return isJson(value) ? value : {};
}

export function exampleFromSchema(root: Json, rawSchema: unknown, depth = 0): unknown {
  const schema = deref(root, rawSchema);
  if (depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const properties = isJson(schema.properties) ? schema.properties : null;
  switch (schema.type) {
    case 'object': {
      const out: Json = {};
      for (const [key, value] of Object.entries(properties ?? {})) out[key] = exampleFromSchema(root, value, depth + 1);
      return out;
    }
    case 'array':
      return [exampleFromSchema(root, schema.items ?? {}, depth + 1)].filter((item) => item !== null);
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      return schema.format === 'date-time' ? '2024-01-15T10:30:00Z' : 'string';
    default:
      if (properties) return exampleFromSchema(root, { type: 'object', properties }, depth + 1);
      return 'string';
  }
}

export function slugId(method: string, path: string): string {
  return `${method}${path}`.toLowerCase().replace(/[{}]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

function curlFor(baseUrl: string, method: string, path: string, body: unknown): string {
  const url = baseUrl + path.replace(/\{([^}]+)\}/g, ':$1');
  const lines = [`curl -X ${method.toUpperCase()} '${url}' \\`, "  -H 'Authorization: Bearer YOUR_API_KEY'"];
  if (body !== null && body !== undefined) {
    lines[1] += ' \\';
    lines.push("  -H 'Content-Type: application/json' \\", `  -d '${JSON.stringify(body)}'`);
  }
  return lines.join('\n');
}

function schemaForSpec(root: Json, rawSchema: unknown): Json {
  const schema = deref(root, rawSchema);
  const properties: Json = {};
  for (const [name, value] of Object.entries(isJson(schema.properties) ? schema.properties : {})) {
    const property = deref(root, value);
    const entry: Json = {};
    if (typeof property.type === 'string') entry.type = property.type;
    if (typeof property.description === 'string') entry.description = property.description;
    const example = exampleFromSchema(root, property, 1);
    if (example !== null && example !== undefined) entry.example = example;
    properties[name] = entry;
  }
  const out: Json = { type: typeof schema.type === 'string' ? schema.type : 'object', properties };
  if (Array.isArray(schema.required)) out.required = schema.required;
  return out;
}

export function fromOpenApi(openapi: Json): Spec {
  const info = isJson(openapi.info) ? openapi.info : {};
  const servers = Array.isArray(openapi.servers) ? openapi.servers : [];
  const firstServer = isJson(servers[0]) ? servers[0] : {};
  const baseUrl = typeof firstServer.url === 'string' ? firstServer.url : 'https://api.example.com';
  const title = typeof info.title === 'string' ? info.title : 'API';
  const description = typeof info.description === 'string' ? info.description : '';
  const version = typeof info.version === 'string' ? info.version : '1.0.0';

  const endpoints: Spec['endpoints'] = {};
  const tagsOrder: string[] = [];
  const byTag = new Map<string, { id: string; method: string; path: string; title: string }[]>();
  const paths = isJson(openapi.paths) ? openapi.paths : {};

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(openapi, rawItem);
    for (const method of METHODS) {
      const operation = isJson(item[method]) ? (item[method] as Json) : null;
      if (!operation) continue;
      const operationId = typeof operation.operationId === 'string' ? operation.operationId : '';
      const id = operationId ? slugId('', operationId) : slugId(method, path);
      const summary = typeof operation.summary === 'string' ? operation.summary : `${method.toUpperCase()} ${path}`;

      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .map((parameter) => deref(openapi, parameter));
      const headers = parameters
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) => ({
          name: String(parameter.name),
          value: '',
          required: !!parameter.required,
          description: typeof parameter.description === 'string' ? parameter.description : '',
        }));
      headers.unshift({ name: 'Authorization', value: 'Bearer YOUR_API_KEY', required: true, description: 'API key' });
      const queryParams = parameters
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) => {
          const schema = deref(openapi, parameter.schema);
          return {
            name: String(parameter.name),
            type: typeof schema.type === 'string' ? schema.type : 'string',
            description: typeof parameter.description === 'string' ? parameter.description : '',
            example: parameter.example !== undefined ? String(parameter.example) : '',
            required: !!parameter.required,
          };
        });

      let body: { type: string; schema: Json } | undefined;
      let bodyExample: unknown = null;
      if (operation.requestBody) {
        const requestBody = deref(openapi, operation.requestBody);
        const content = isJson(requestBody.content) ? requestBody.content : {};
        const media = deref(openapi, content['application/json'] ?? Object.values(content)[0]);
        if (media.schema) {
          body = { type: 'json', schema: schemaForSpec(openapi, media.schema) };
          bodyExample = exampleFromSchema(openapi, media.schema);
        }
      }

      const responses: Record<string, { description: string; examples: Record<string, { summary: string; value: unknown }> }> = {};
      for (const [code, rawResponse] of Object.entries(isJson(operation.responses) ? operation.responses : {})) {
        if (!/^\d{3}$/.test(code)) continue;
        const response = deref(openapi, rawResponse);
        const content = isJson(response.content) ? response.content : {};
        const media = deref(openapi, content['application/json'] ?? Object.values(content)[0]);
        const responseDescription = typeof response.description === 'string' ? response.description : '';
        responses[code] = {
          description: responseDescription,
          examples: {
            success: { summary: responseDescription || `HTTP ${code}`, value: media.schema ? exampleFromSchema(openapi, media.schema) : {} },
          },
        };
      }

      const upperMethod = method.toUpperCase() as Uppercase<Method>;
      endpoints[id] = {
        method: upperMethod,
        path,
        title: summary,
        description: typeof operation.description === 'string' ? operation.description : summary,
        authentication: true,
        request: { headers, query_params: queryParams, ...(body ? { body } : {}) },
        responses,
        code_examples: [
          {
            id: `${id}-curl`,
            tech: 'curl',
            name: 'cURL',
            language: 'bash',
            title: `${summary} with cURL`,
            description: '',
            code: curlFor(baseUrl, method, path, bodyExample),
          },
        ],
      };

      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : 'Endpoints';
      if (!byTag.has(tag)) {
        byTag.set(tag, []);
        tagsOrder.push(tag);
      }
      byTag.get(tag)!.push({ id, method: upperMethod, path, title: summary });
    }
  }

  return {
    site_config: {
      name: title,
      brand: title,
      use_logos: false,
      brand_icon: 'fas fa-cube',
      default_theme: 'system',
      page_titles: { base_title: `${title} Docs`, separator: ' | ', routes: {} },
    },
    api: { name: title, version, description, base_url: baseUrl },
    navigation: [{ id: 'home', title: 'Home', icon: 'fas fa-home', type: 'page' }],
    sections: tagsOrder.map((tag) => ({ title: tag, icon: 'fas fa-server', endpoints: byTag.get(tag) ?? [] })),
    pages: {
      home: { template: 'hero', content: { hero: { title, subtitle: description || 'API Documentation', stats: [] } } },
    },
    endpoints,
  };
}
