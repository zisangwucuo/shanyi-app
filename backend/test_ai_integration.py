import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from app import main as api, stylist, tryon
from test_stylist import FakeClient
from test_tryon import encoded_image

PNG = encoded_image()


class AIIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {**{f'SHANYI_{kind}_{field}': '' for kind in ('VISION', 'STYLIST', 'TRYON') for field in ('BASE_URL', 'API_KEY', 'MODEL')}, 'SHANYI_AUTH_MODE': 'development'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.db = patch.object(api, 'DB_PATH', Path(tempfile.mkdtemp()) / 'test.db')
        self.db.start()
        self.addCleanup(self.db.stop)
        await api.init_db()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False), base_url='http://test')
        self.addAsyncCleanup(self.client.aclose)
        await self.client.post('/api/auth/send-code', json={'phone': '13800000001'})
        response = await self.client.post('/api/auth/verify', json={'phone': '13800000001', 'code': '123456'})
        self.headers = {'Authorization': 'Bearer ' + response.json()['token']}
        self.payload = {'weather': '晴朗', 'temperature': 25, 'occasion': '周末', 'missing_categories': ['鞋履'], 'items': [{'category': '连衣裙', 'name': '白色连衣裙'}]}
        FakeClient.error = None
        FakeClient.request = None

    def configure(self, kind):
        for field, value in [('BASE_URL', 'https://provider.example/v1'), ('API_KEY', 'test-only-secret'), ('MODEL', 'test-model')]:
            os.environ[f'SHANYI_{kind}_{field}'] = value

    async def test_rules_are_labeled_when_unconfigured(self):
        response = await self.client.post('/api/stylist/complete', headers=self.headers, json=self.payload)
        self.assertEqual(response.json()['source'], 'rules')
        self.assertIn('未配置', response.json()['note'])

    async def test_ai_candidates_account_isolation_and_success(self):
        self.configure('STYLIST')
        await api.create_wardrobe_item('13800000001', api.WardrobeInput(name='我的鞋', category='鞋履'))
        await api.create_wardrobe_item('13900000002', api.WardrobeInput(name='他人秘密鞋', category='鞋履'))
        FakeClient.response_result = {'choices': [{'message': {'content': json.dumps({'selections': [{'id': '0', 'reason': '白裙搭配简洁鞋履'}]})}}]}
        with patch('app.stylist.httpx.AsyncClient', FakeClient):
            response = await self.client.post('/api/stylist/complete?phone=13900000002', headers=self.headers, json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['source'], 'ai')
        self.assertEqual(response.json()['suggestions'][0]['wardrobe_item']['name'], '我的鞋')
        sent = json.dumps(FakeClient.request['json'], ensure_ascii=False)
        self.assertNotIn('他人秘密鞋', sent)
        self.assertNotIn('13800000001', sent)
        self.assertNotIn('test-only-secret', response.text)

    async def test_ai_invalid_candidates_and_timeout(self):
        self.configure('STYLIST')
        for selections in ([{'id': 'foreign', 'reason': 'fake'}], [], [{'id': '0', 'reason': ''}], [{'id': '0', 'reason': 'x'}, {'id': '0', 'reason': 'x'}]):
            FakeClient.response_result = {'choices': [{'message': {'content': json.dumps({'selections': selections})}}]}
            with patch('app.stylist.httpx.AsyncClient', FakeClient):
                response = await self.client.post('/api/stylist/complete', headers=self.headers, json=self.payload)
            self.assertEqual(response.status_code, 502, response.text)
        FakeClient.error = httpx.ReadTimeout('test-only-secret')
        with patch('app.stylist.httpx.AsyncClient', FakeClient):
            response = await self.client.post('/api/stylist/complete', headers=self.headers, json=self.payload)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('test-only-secret', response.text)

    async def post_tryon(self, **overrides):
        values = {'outfit_id': api.CATALOG['outfits'][0]['id'], 'consent': 'true'}
        values.update(overrides)
        return await self.client.post('/api/tryon/generate', headers=self.headers, data=values, files={'file': ('person.png', PNG, 'image/png')})

    async def test_tryon_requires_auth_configuration_and_consent(self):
        self.assertEqual((await self.client.get('/api/tryon/config')).status_code, 401)
        self.assertEqual((await self.post_tryon()).status_code, 503)
        self.configure('TRYON')
        self.assertEqual((await self.post_tryon(consent='false')).status_code, 400)
        self.assertEqual((await self.post_tryon(outfit_id='unknown')).status_code, 404)
        response = await self.client.post('/api/tryon/generate', headers=self.headers, data={'outfit_id': api.CATALOG['outfits'][0]['id'], 'consent': 'true'}, files={'file': ('x.png', b'broken', 'image/png')})
        self.assertEqual(response.status_code, 400)

    async def test_tryon_upload_validation_before_generation(self):
        self.configure('TRYON')
        photo = encoded_image('JPEG') + b'phone-trailing-metadata'
        result = {'outfit_id': api.CATALOG['outfits'][0]['id'], 'image_url': 'data:image/png;base64,' + base64.b64encode(PNG).decode(), 'notice': tryon.NOTICE}
        for data, status in [(photo, 200), (photo[:100], 400)]:
            with self.subTest(status=status), patch('app.tryon.generate', AsyncMock(return_value=result)) as generate:
                response = await self.client.post('/api/tryon/generate', headers=self.headers,
                    data={'outfit_id': result['outfit_id'], 'consent': 'true'},
                    files={'file': ('person.jpg', data, 'image/jpeg')})
                self.assertEqual(response.status_code, status, response.text)
                if status == 200:
                    generate.assert_awaited_once()
                    self.assertEqual(generate.call_args.args[2:4], (photo, '.jpg'))
                else:
                    generate.assert_not_awaited()
                    self.assertNotIn('费用', response.text)

    async def test_tryon_timeout_sanitization(self):
        self.configure('TRYON')
        for error, status in [(httpx.ReadTimeout('test-only-secret'), 504), (httpx.ConnectError('test-only-secret'), 502)]:
            with patch('app.tryon.generate', AsyncMock(side_effect=error)):
                response = await self.post_tryon()
            self.assertEqual(response.status_code, status)
            self.assertNotIn('test-only-secret', response.text)

    async def test_tryon_real_multipart_and_b64_contract_mocked(self):
        self.configure('TRYON')
        captured = []
        def handler(request):
            captured.append(request)
            if request.method == 'GET':
                self.assertNotIn('authorization', request.headers)
                return httpx.Response(200, content=PNG)
            body = request.content
            self.assertEqual(body.count(b'name="image[]"'), 2)
            self.assertIn(b'person.png', body)
            self.assertIn(b'outfit-0.png', body)
            self.assertEqual(str(request.url), 'https://provider.example/v1/images/edits')
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(PNG).decode()}]})
        factory = httpx.AsyncClient
        with patch('app.tryon.httpx.AsyncClient', side_effect=lambda **kw: factory(transport=httpx.MockTransport(handler), **kw)):
            response = await self.post_tryon()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['image_url'].startswith('data:image/png;base64,'))
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(len(captured), 2)

    async def test_tryon_invalid_model_image_and_untrusted_reference(self):
        self.configure('TRYON')
        factory = httpx.AsyncClient
        def handler(request):
            return httpx.Response(200, content=PNG) if request.method == 'GET' else httpx.Response(200, json={'data': [{'b64_json': 'not-image'}]})
        with patch('app.tryon.httpx.AsyncClient', side_effect=lambda **kw: factory(transport=httpx.MockTransport(handler), **kw)):
            response = await self.post_tryon()
        self.assertEqual(response.status_code, 502)
        with self.assertRaises(api.HTTPException):
            await tryon.reference_image(None, 'http://127.0.0.1/private')

    async def test_vision_timeout_does_not_leak(self):
        self.configure('VISION')
        FakeClient.error = httpx.ReadTimeout('test-only-secret')
        with patch('app.stylist.httpx.AsyncClient', FakeClient):
            response = await self.client.post('/api/stylist/analyze', headers=self.headers, data={'consent': 'true'}, files={'file': ('person.png', PNG, 'image/png')})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('test-only-secret', response.text)


if __name__ == '__main__':
    unittest.main()
