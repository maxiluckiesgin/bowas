#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', ' ', name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or 'Unnamed endpoint'


def request_body_from_operation(operation: dict):
    req = operation.get('requestBody', {}) or {}
    content = req.get('content', {}) or {}
    app_json = content.get('application/json', {}) or {}
    examples = app_json.get('examples', {}) or {}

    if examples:
        first = next(iter(examples.values()))
        value = first.get('value', {}) if isinstance(first, dict) else {}
        return value if isinstance(value, dict) else {}
    return {}


def responses_examples(operation: dict, default_req_body: dict):
    out = []
    req_examples = ((operation.get('requestBody', {}) or {}).get('content', {}) or {}).get('application/json', {})
    req_examples = req_examples.get('examples', {}) or {}

    req_example_items = []
    for name, obj in req_examples.items():
        if isinstance(obj, dict) and isinstance(obj.get('value'), dict):
            req_example_items.append((name, obj['value']))

    if not req_example_items:
        req_example_items = [('default', default_req_body)]

    responses = operation.get('responses', {}) or {}
    for status, resp in responses.items():
        status_str = str(status)
        status_text = {
            '200': 'OK',
            '201': 'Created',
            '204': 'No Content',
            '400': 'Bad Request',
            '401': 'Unauthorized',
            '403': 'Forbidden',
            '404': 'Not Found',
            '409': 'Conflict',
            '500': 'Internal Server Error',
            '503': 'Service Unavailable',
        }.get(status_str, 'Response')

        content = (resp.get('content', {}) or {}).get('application/json', {}) or {}
        examples = content.get('examples', {}) or {}

        if examples:
            for ex_name, ex_obj in examples.items():
                resp_body = ex_obj.get('value', {}) if isinstance(ex_obj, dict) else {}
                req_name, req_body = req_example_items[0]
                out.append(
                    {
                        'name': f"{ex_name} ({req_name})" if req_name != 'default' else ex_name,
                        'status': int(status_str) if status_str.isdigit() else 200,
                        'statusText': status_text,
                        'reqBody': req_body,
                        'respBody': resp_body if isinstance(resp_body, dict) else {},
                    }
                )
        else:
            req_name, req_body = req_example_items[0]
            out.append(
                {
                    'name': f"status{status_str} ({req_name})" if req_name != 'default' else f"status{status_str}",
                    'status': int(status_str) if status_str.isdigit() else 200,
                    'statusText': status_text,
                    'reqBody': req_body,
                    'respBody': {},
                }
            )

    return out


def main():
    parser = argparse.ArgumentParser(
        description='Sync missing endpoint files from OpenAPI JSON into a BOWAS API directory.'
    )
    parser.add_argument(
        '--openapi-json',
        default=os.getenv('OPENAPI_JSON', './openapi.json'),
        help='Path to openapi.json (default: $OPENAPI_JSON or ./openapi.json)',
    )
    parser.add_argument(
        '--target-dir',
        default=os.getenv('TARGET_DIR'),
        help='Target directory for endpoint yml files (default: $TARGET_DIR)',
    )
    args = parser.parse_args()

    if not args.target_dir:
        print('target directory is required: use --target-dir or set TARGET_DIR', file=sys.stderr)
        return 1

    openapi_json = Path(args.openapi_json)
    target_dir = Path(args.target_dir)

    if not openapi_json.is_file():
        print(f'openapi json not found: {openapi_json}', file=sys.stderr)
        return 1

    if not target_dir.is_dir():
        print(f'target directory not found: {target_dir}', file=sys.stderr)
        return 1

    doc = json.loads(openapi_json.read_text(encoding='utf-8'))
    paths = doc.get('paths', {})

    existing = set()
    existing_files = {}
    max_seq = 0

    for yml in target_dir.glob('*.yml'):
        if yml.name == 'opencollection.yml':
            continue
        try:
            data = yaml.safe_load(yml.read_text(encoding='utf-8')) or {}
        except Exception:
            continue

        info = data.get('info', {}) or {}
        seq = info.get('seq')
        if isinstance(seq, int):
            max_seq = max(max_seq, seq)

        http = data.get('http', {}) or {}
        method = str(http.get('method', '')).upper()
        url = str(http.get('url', ''))
        if method and url:
            key = (method, url)
            existing.add(key)
            existing_files[key] = (yml, seq if isinstance(seq, int) else None)

    added = []
    updated = []
    next_seq = max_seq + 1

    for path, methods in paths.items():
        for method, operation in methods.items():
            m = method.upper()
            url = f"{{{{baseUrl}}}}{path}"
            key = (m, url)

            name = operation.get('summary') or operation.get('operationId') or f'{m} {path}'

            existing_entry = existing_files.get(key)
            if existing_entry:
                file_path, existing_seq = existing_entry
                seq_value = existing_seq if existing_seq is not None else next_seq
            else:
                file_name = sanitize_filename(name) + '.yml'
                file_path = target_dir / file_name

                i = 2
                while file_path.exists():
                    file_path = target_dir / (sanitize_filename(name) + f' ({i}).yml')
                    i += 1
                seq_value = next_seq

            req_body = request_body_from_operation(operation)
            security = operation.get('security', []) or []
            bearer = any('bearerAuth' in sec for sec in security if isinstance(sec, dict))

            doc_out = {
                'info': {'name': name, 'type': 'http', 'seq': seq_value},
                'http': {'method': m, 'url': url},
                'settings': {
                    'encodeUrl': True,
                    'timeout': 0,
                    'followRedirects': True,
                    'maxRedirects': 5,
                },
            }

            if m in {'POST', 'PUT', 'PATCH'}:
                doc_out['http']['body'] = {'type': 'json', 'data': json.dumps(req_body, indent=2)}

            doc_out['http']['auth'] = {'type': 'bearer', 'token': '{{token}}'} if bearer else 'inherit'

            ex_items = responses_examples(operation, req_body)
            if ex_items:
                ex_out = []
                for ex in ex_items:
                    req_obj = {'url': url, 'method': m}
                    if m in {'POST', 'PUT', 'PATCH'}:
                        req_obj['body'] = {'type': 'json', 'data': json.dumps(ex['reqBody'], indent=2)}

                    ex_out.append(
                        {
                            'name': ex['name'],
                            'request': req_obj,
                            'response': {
                                'status': ex['status'],
                                'statusText': ex['statusText'],
                                'headers': [{'name': 'Content-Type', 'value': 'application/json'}],
                                'body': {'type': 'json', 'data': json.dumps(ex['respBody'], indent=2)},
                            },
                        }
                    )
                doc_out['examples'] = ex_out

            yaml_text = yaml.safe_dump(doc_out, sort_keys=False, allow_unicode=False)
            yaml_text = yaml_text.replace("'{{baseUrl}}", '"{{baseUrl}}').replace("}}'", '}}"')
            yaml_text = yaml_text.replace("token: '{{token}}'", 'token: "{{token}}"')

            file_path.write_text(yaml_text, encoding='utf-8')
            if existing_entry:
                updated.append(str(file_path))
            else:
                added.append(str(file_path))
                existing.add(key)
                next_seq += 1

    if added:
        print('Added files:')
        for p in added:
            print('-', p)

    if updated:
        print('Updated files:')
        for p in updated:
            print('-', p)

    if not added and not updated:
        print('No diff to add. Collection already up to date.')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
