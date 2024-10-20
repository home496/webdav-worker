/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const VERSION = "1.01"

export interface Env {
		// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
		// MY_KV_NAMESPACE: KVNamespace;
		//
		// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
		// MY_DURABLE_OBJECT: DurableObjectNamespace;
		//
		// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
		bucket: R2Bucket;
		//
		// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
		// MY_SERVICE: Fetcher;
		//
		// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
		// MY_QUEUE: Queue;

		// Variables defined in the "Environment Variables" section of the Wrangler CLI or dashboard
		SECRET: string;

}

function make_resource_path(request: Request): string {
		let path = new URL(request.url).pathname.slice(1);
		path = path.endsWith('/') ? path.slice(0, -1) : path;
		return path;
}

async function handle_get(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		if (request.url.endsWith('/')) {
				let page = '';
				if (resource_path !== '') page += `<a href="../">..</a><br>`;
				for await (const object of listAll(bucket, resource_path)) {
						if (object.key === resource_path) {
								continue;
						}
						let href = `/${object.key + (object.customMetadata?.resourcetype === '<collection />' ? '/' : '')}`;
						page += `<a href="${href}">${object.httpMetadata?.contentDisposition ?? object.key}</a><br>`;
				}
				return new Response(page, {
						status: 200,
						headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
		} else {
				let object = await bucket.get(resource_path, {
						onlyIf: request.headers,
						range: request.headers,
				});

				if (object === null) {
						return new Response('Not Found', { status: 404 });
				}

				const headers = new Headers()
				object.writeHttpMetadata(headers)
				headers.set('etag', object.httpEtag)
				if (object.range) {
						headers.set("content-range", `bytes ${object.range.offset}-${object.range.end ?? object.size - 1}/${object.size}`)
				}
				const status = object.body ? (request.headers.get("range") !== null ? 206 : 200) : 304
				return new Response(object.body, {
						headers,
						status
				})
		}
}

async function handle_put(request: Request, bucket: R2Bucket): Promise<Response> {
		if (request.url.endsWith('/')) {
				return new Response('Method Not Allowed', { status: 405 });
		}

		let resource_path = make_resource_path(request);

		// Check if the parent directory exists
		let dirpath = resource_path.split('/').slice(0, -1).join('/');
		if (dirpath !== '') {
				let dir = await bucket.head(dirpath);
				if (!(dir && dir.customMetadata?.resourcetype === '<collection />')) {
						return new Response('Conflict', { status: 409 });
				}
		}

		const object = await bucket.put(resource_path, request.body, {
				httpMetadata: request.headers,
		})
		return new Response(null, {
				headers: {
						'etag': object.httpEtag,
				},
				status: 201
		})
		// let body = await request.arrayBuffer();
		// await bucket.put(resource_path, body, {
		// 		onlyIf: request.headers,
		// 		httpMetadata: request.headers,
		// });
		// return new Response('', { status: 201 });
}

async function handle_post(request: Request, bucket: R2Bucket, env:Env): Promise<Response> {
		if (request.url.endsWith('/')) {
				return new Response('Method Not Allowed', { status: 405 });
		}

		let resource_path = make_resource_path(request);
		const text = await request.text();
		let data;
		if(text){
				data = JSON.parse(text);
		}

		switch (resource_path) {
				case "version":
						return new Response(VERSION, { status:200 });
				default:
						return new Response(null, { status: 404 });
		}
}

async function handle_delete(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		const body = await request.text();
		if(body){
				await bucket.delete(JSON.parse(body));
				return new Response(null, { status: 204 });
		}

		if (resource_path === '') {
				let r2_objects,
						cursor: string | undefined = undefined;
				do {
						r2_objects = await bucket.list({ cursor: cursor });
						let keys = r2_objects.objects.map((object) => object.key);
						if (keys.length > 0) {
								await bucket.delete(keys);
						}

						if (r2_objects.truncated) {
								cursor = r2_objects.cursor;
						}
				} while (r2_objects.truncated);

				return new Response(null, { status: 204 });
		}

		let resource = await bucket.head(resource_path);
		if (resource === null) {
				return new Response('Not Found', { status: 404 });
		}
		await bucket.delete(resource_path);
		if (resource.customMetadata?.resourcetype !== '<collection />') {
				return new Response(null, { status: 204 });
		}

		let r2_objects,
				cursor: string | undefined = undefined;
		do {
				r2_objects = await bucket.list({
						prefix: resource_path + '/',
						cursor: cursor,
				});
				let keys = r2_objects.objects.map((object) => object.key);
				if (keys.length > 0) {
						await bucket.delete(keys);
				}

				if (r2_objects.truncated) {
						cursor = r2_objects.cursor;
				}
		} while (r2_objects.truncated);

		return new Response(null, { status: 204 });
}

function generateUUID() {
		// 创建一个随机的UUID v4
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
				let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
				return v.toString(16);
		});
}

const SUPPORT_METHODS = ['OPTIONS', 'GET', 'PUT', 'POST', 'DELETE'];


async function dispatch_handler(request: Request, bucket: R2Bucket, env: Env): Promise<Response> {
		switch (request.method) {
				case 'OPTIONS': {
						return new Response(null, {
								status: 204,
								headers: {
										Allow: SUPPORT_METHODS.join(', '),
								},
						});
				}
				case 'GET': {
						return await handle_get(request, bucket);
				}
				case 'PUT': {
						return await handle_put(request, bucket);
				}
				case 'DELETE': {
						return await handle_delete(request, bucket);
				}
				case 'POST': {
						return await handle_post(request, bucket, env);
				}
				default: {
						return new Response('Method Not Allowed', {
								status: 405,
								headers: {
										Allow: SUPPORT_METHODS.join(', ')
								},
						});
				}
		}
}

async function checkAuth(request: Request, env: Env) : Promise<boolean> {
		if(request.method === 'OPTIONS'){
				return true;
		}

		if(request.method === 'POST'){
				const path = make_resource_path(request);
				if(path === 'version' ){
						return true;
				}
		}

		return request.headers.get('Authorization') === env.SECRET;
}

export default {
		async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
				const { bucket } = env;

				if (!await checkAuth(request, env)) {
						return new Response('Unauthorized', {
								status: 401,
								headers: {
										'WWW-Authenticate': 'Basic realm="webdav-worker"',
								},
						});
				}

				let response: Response = await dispatch_handler(request, bucket, env);

				// Set CORS headers
				response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') ?? '*');
				response.headers.set('Access-Control-Allow-Methods', SUPPORT_METHODS.join(', '));
				// response.headers.set(
				// 		'Access-Control-Allow-Headers',
				// 		['authorization', 'content-type', 'depth', 'overwrite', 'destination', 'range'].join(', '),
				// );
				// response.headers.set(
				// 		'Access-Control-Expose-Headers',
				// 		['content-type', 'content-length', 'dav', 'etag', 'last-modified', 'location', 'date', 'content-range'].join(
				// 				', ',
				// 		),
				// );
				response.headers.set('Access-Control-Allow-Credentials', 'false');
				response.headers.set('Access-Control-Max-Age', '86400');

				return response;
		},
};
