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

import { Require } from './auth';
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

    const directory = imageDirectory();

    await mkdir(directory, {
      recursive: true,
    });

    const filename =
      `${randomUUID()}.${type.extension}`;

    await writeFile(
      resolve(directory, filename),
      file.buffer,
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
      'private, max-age=86400',
    );

    return new StreamableFile(
      createReadStream(path),
    );
  }
}