import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { Public, Require } from './auth';
import { DomainError } from './http';
import type { Response } from './transport';

type ProductImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const imageTypes: Record<
  string,
  {
    extension: string;
    contentType: string;
  }
> = {
  'image/jpeg': {
    extension: 'jpg',
    contentType: 'image/jpeg',
  },
  'image/png': {
    extension: 'png',
    contentType: 'image/png',
  },
  'image/webp': {
    extension: 'webp',
    contentType: 'image/webp',
  },
};

function imageDirectory() {
  return resolve(
    process.env.PRODUCT_IMAGE_DIR ??
      'storage/product-images',
  );
}

@Controller()
export class ProductImagesController {
  @Require('pricing.update')
  @Post('commercial/product-images')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile()
    file: ProductImageFile | undefined,
  ) {
    return this.store(file);
  }

  @Require('menus.manage')
  @Post('menus/menu-images')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadMenuImage(
    @UploadedFile() file: ProductImageFile | undefined,
  ) {
    return this.store(file);
  }

  private async store(file: ProductImageFile | undefined) {
    if (!file) {
      throw new DomainError(
        'PRODUCT_IMAGE_REQUIRED',
        'Une image du produit est obligatoire.',
        400,
      );
    }

    const type = imageTypes[file.mimetype];

    if (!type) {
      throw new DomainError(
        'PRODUCT_IMAGE_TYPE_INVALID',
        'Formats autorisés : JPG, PNG et WEBP.',
        400,
      );
    }

    if (!file.buffer?.length) {
      throw new DomainError(
        'PRODUCT_IMAGE_EMPTY',
        'Le fichier image est vide.',
        400,
      );
    }
    let safeImage: Buffer;
    try {
      const decoder = sharp(file.buffer, {limitInputPixels: 25_000_000, animated: false, failOn:'warning'});
      const metadata = await decoder.metadata();
      if (!['jpeg','png','webp'].includes(metadata.format ?? '') || `image/${metadata.format}` !== file.mimetype) throw new Error('Format mismatch');
      // Reencode to remove metadata and trailing non-image content.
      safeImage = await decoder.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
    } catch {
      throw new DomainError('PRODUCT_IMAGE_TYPE_INVALID', 'Image invalide ou trop volumineuse. Formats autorisés : JPG, PNG et WEBP.',400);
    }

    const directory = imageDirectory();

    await mkdir(directory, {
      recursive: true,
    });

    const filename =
      `${randomUUID()}.webp`;

    await writeFile(
      resolve(directory, filename),
      safeImage,
      {
        flag: 'wx',
      },
    );

    return {
      success: true,
      data: {
        url: `/api/v1/product-images/${filename}`,
      },
    };
  }

  @Public()
  @Get('product-images/:filename')
  async image(
    @Param('filename') filename: string,
    @Res({ passthrough: true })
    response: Response,
  ) {
    if (
      !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(
        filename,
      )
    ) {
      throw new DomainError(
        'IMAGE_NOT_FOUND',
        'Image introuvable.',
        404,
      );
    }

    const extension =
      filename.split('.').pop()?.toLowerCase();

    const contentType =
      extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : 'image/jpeg';

    const path = resolve(
      imageDirectory(),
      filename,
    );

    try {
      await stat(path);
    } catch {
      throw new DomainError(
        'IMAGE_NOT_FOUND',
        'Image introuvable.',
        404,
      );
    }

    response.setHeader(
      'Content-Type',
      contentType,
    );

    response.setHeader(
      'Cache-Control',
      'public, max-age=86400, immutable',
    );

    return new StreamableFile(
      createReadStream(path),
    );
  }
}
