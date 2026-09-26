import { expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { ProductImagesController } from './product-images';
it('validates bytes, reencodes images and keeps the portable path',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jami-image-test-'));
  const previous=process.env.PRODUCT_IMAGE_DIR;process.env.PRODUCT_IMAGE_DIR=dir;
  try {
    const controller=new ProductImagesController();
    const buffer=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
    const result=await controller.upload({buffer,size:buffer.length,mimetype:'image/png',originalname:'test.png'});
    expect(result.data.url).toMatch(/^\/api\/v1\/product-images\/.*\.webp$/);
    expect((await sharp(await readFile(join(dir,basename(result.data.url)))).metadata()).format).toBe('webp');
    await expect(controller.upload({buffer:Buffer.from('<script>bad</script>'),size:20,mimetype:'image/png',originalname:'fake.png'})).rejects.toThrow();
    await expect(controller.upload(undefined)).rejects.toThrow();
  } finally { if(previous===undefined)delete process.env.PRODUCT_IMAGE_DIR;else process.env.PRODUCT_IMAGE_DIR=previous;await rm(dir,{recursive:true,force:true}); }
});
