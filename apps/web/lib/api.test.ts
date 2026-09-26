import { afterEach, expect, it, vi } from 'vitest';
import { api, apiForm } from './api';
import { productImageUrl } from './product-image';
afterEach(()=>vi.unstubAllGlobals());
it('uses the same-origin proxy and credentials for JSON and image uploads',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id:'ok'}})));
  vi.stubGlobal('fetch',fetcher);
  await api('/products',{name:'Repas'},'stable-key');
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/products');
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'include',headers:{'Idempotency-Key':'stable-key'}});
  fetcher.mockResolvedValue(new Response(JSON.stringify({success:true,data:{url:'image'}})));
  await apiForm('/commercial/product-images',new FormData());
  expect(fetcher.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
});
it('preserves backend field errors',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,error:{fields:{fieldErrors:{imageUrl:['Obligatoire']}}}}),{status:400})));
  await expect(api('/products',{})).rejects.toThrow('imageUrl : Obligatoire');
});
it('reports proxy failures instead of a JSON syntax error',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('Bad gateway',{status:502})));
  await expect(api('/products')).rejects.toThrow('HTTP 502');
});
it('accepts portable image paths and rejects foreign or executable URLs',()=>{
  const image='/api/v1/product-images/00000000-0000-0000-0000-000000000001.webp';
  expect(productImageUrl(image)).toBe(image);
  for(const value of [null,'javascript:alert(1)','http://localhost:3001'+image,'/api/v1/product-images/../../.env']) expect(productImageUrl(value)).toBeNull();
});
