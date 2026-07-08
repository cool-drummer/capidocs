#!/usr/bin/env node
// Convert an OpenAPI 3.x JSON spec into a capidocs api-spec.json.
// No dependencies (JSON input only; convert YAML→JSON beforehand if needed).
//
// Usage: node build/openapi-to-capidocs.mjs <openapi.json> [output.json]

import { readFileSync, writeFileSync } from 'node:fs';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function resolveRef(spec, ref) {
    if (!ref || ref[0] !== '#') return null;
    return ref.slice(2).split('/').reduce(function (acc, part) {
        return acc ? acc[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
    }, spec);
}

function deref(spec, obj) {
    if (obj && obj.$ref) return resolveRef(spec, obj.$ref) || {};
    return obj || {};
}

function exampleFromSchema(spec, schema, depth) {
    schema = deref(spec, schema);
    depth = depth || 0;
    if (depth > 6 || !schema) return null;
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum && schema.enum.length) return schema.enum[0];
    switch (schema.type) {
        case 'object': {
            const out = {};
            const props = schema.properties || {};
            Object.keys(props).forEach(function (k) { out[k] = exampleFromSchema(spec, props[k], depth + 1); });
            return out;
        }
        case 'array':
            return [exampleFromSchema(spec, schema.items || {}, depth + 1)].filter(function (x) { return x !== null; });
        case 'integer':
        case 'number': return 0;
        case 'boolean': return true;
        case 'string':
            if (schema.format === 'date-time') return '2024-01-15T10:30:00Z';
            return 'string';
        default:
            if (schema.properties) return exampleFromSchema(spec, { type: 'object', properties: schema.properties }, depth + 1);
            return 'string';
    }
}

function slugId(method, path) {
    return (method + path).toLowerCase().replace(/[{}]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

function curlFor(baseUrl, method, path, params, body) {
    const url = baseUrl + path.replace(/\{([^}]+)\}/g, ':$1');
    const lines = ['curl -X ' + method.toUpperCase() + " '" + url + "' \\", "  -H 'Authorization: Bearer YOUR_API_KEY'"];
    if (body) { lines[1] += ' \\'; lines.push("  -H 'Content-Type: application/json' \\", "  -d '" + JSON.stringify(body) + "'"); }
    return lines.join('\n');
}

function convert(spec) {
    const info = spec.info || {};
    const baseUrl = (spec.servers && spec.servers[0] && spec.servers[0].url) || 'https://api.example.com';
    const endpoints = {};
    const sectionEndpoints = [];
    const tagsOrder = [];

    Object.keys(spec.paths || {}).forEach(function (path) {
        const item = spec.paths[path];
        METHODS.forEach(function (method) {
            const op = item[method];
            if (!op) return;
            const id = op.operationId ? slugId('', op.operationId) : slugId(method, path);
            const allParams = (item.parameters || []).concat(op.parameters || []).map(function (p) { return deref(spec, p); });
            const headers = allParams.filter(function (p) { return p.in === 'header'; }).map(function (p) {
                return { name: p.name, value: '', required: !!p.required, description: p.description || '' };
            });
            headers.unshift({ name: 'Authorization', value: 'Bearer YOUR_API_KEY', required: true, description: 'API key' });
            const query = allParams.filter(function (p) { return p.in === 'query'; }).map(function (p) {
                const sch = deref(spec, p.schema || {});
                return { name: p.name, type: sch.type || 'string', description: p.description || '', example: p.example !== undefined ? String(p.example) : '', required: !!p.required };
            });

            let bodyObj = null, bodyExample = null;
            if (op.requestBody) {
                const rb = deref(spec, op.requestBody);
                const json = rb.content && (rb.content['application/json'] || rb.content[Object.keys(rb.content)[0]]);
                if (json && json.schema) { bodyObj = { type: 'json', schema: deref(spec, json.schema) }; bodyExample = exampleFromSchema(spec, json.schema); }
            }

            const responses = {};
            Object.keys(op.responses || {}).forEach(function (code) {
                const r = deref(spec, op.responses[code]);
                const json = r.content && (r.content['application/json'] || r.content[Object.keys(r.content)[0]]);
                responses[code] = { description: r.description || '', examples: { success: { summary: r.description || ('HTTP ' + code), value: json && json.schema ? exampleFromSchema(spec, json.schema) : {} } } };
            });

            endpoints[id] = {
                method: method.toUpperCase(),
                path: path,
                title: op.summary || (method.toUpperCase() + ' ' + path),
                description: op.description || op.summary || '',
                authentication: true,
                request: { headers: headers, query_params: query, body: bodyObj || undefined },
                responses: responses,
                code_examples: [
                    { id: id + '-curl', tech: 'curl', name: 'cURL', language: 'bash', title: (op.summary || 'Request') + ' with cURL', description: '', code: curlFor(baseUrl, method, path, query, bodyExample) }
                ]
            };
            const tag = (op.tags && op.tags[0]) || 'Endpoints';
            if (tagsOrder.indexOf(tag) === -1) tagsOrder.push(tag);
            sectionEndpoints.push({ tag: tag, ep: { id: id, method: method.toUpperCase(), path: path, title: op.summary || path } });
        });
    });

    const sections = tagsOrder.map(function (tag) {
        return { title: tag, icon: 'fas fa-server', endpoints: sectionEndpoints.filter(function (s) { return s.tag === tag; }).map(function (s) { return s.ep; }) };
    });

    return {
        site_config: { name: info.title || 'API Documentation', brand: info.title || 'API', use_logos: false, brand_icon: 'fas fa-cube', default_theme: 'dark', page_titles: { base_title: (info.title || 'API') + ' Docs', separator: ' | ', routes: {} } },
        api: { name: info.title || 'API', version: info.version || '1.0.0', description: info.description || '', base_url: baseUrl },
        navigation: [{ id: 'home', title: 'Home', icon: 'fas fa-home', type: 'page' }],
        sections: sections,
        pages: { home: { template: 'hero', content: { hero: { title: info.title || 'API', subtitle: info.description || 'API Documentation', stats: [] } } } },
        endpoints: endpoints,
        features: { syntax_highlighting: true, code_copy: true, dark_mode: true, search: true, mobile_responsive: true }
    };
}

const input = process.argv[2];
const output = process.argv[3] || 'config/api-spec.json';
if (!input) { console.error('Usage: node build/openapi-to-capidocs.mjs <openapi.json> [output.json]'); process.exit(1); }
const spec = JSON.parse(readFileSync(input, 'utf8'));
const result = convert(spec);
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
const n = Object.keys(result.endpoints).length;
console.log('Wrote ' + output + ' with ' + n + ' endpoints from OpenAPI "' + (spec.info && spec.info.title) + '".');
