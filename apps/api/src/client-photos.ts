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

import {
  createReadStream,
} from 'node:fs';

import {
  mkdir,
  stat,
  writeFile,
} from 'node:fs/promises';

import {
  randomUUID,
} from 'node:crypto';

import {
  resolve,
} from 'node:path';

import { Require } from './auth';
import { DomainError } from './http';
import type { Response } from './transport';

type ClientPhoto = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const types: Record<
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

function photoDirectory() {
  return resolve(
    process.env.CLIENT_PHOTO_DIR ??
      'storage/client-photos',
  );
}

function validSignature(
  file: ClientPhoto,
) {
  const buffer = file.buffer;

  if (
    file.mimetype === 'image/jpeg'
  ) {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (
    file.mimetype === 'image/png'
  ) {
    const signature =
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]);

    return (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(signature)
    );
  }

  if (
    file.mimetype === 'image/webp'
  ) {
    return (
      buffer.length >= 12 &&
      buffer
        .subarray(0, 4)
        .toString() === 'RIFF' &&
      buffer
        .subarray(8, 12)
        .toString() === 'WEBP'
    );
  }

  return false;
}

@Controller('client-photos')
export class ClientPhotosController {
  @Require('clients.create')
  @Post()
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: {
        files: 1,
        fileSize:
          4 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile()
    file: ClientPhoto | undefined,
  ) {
    if (!file) {
      throw new DomainError(
        'CLIENT_PHOTO_REQUIRED',
        'Sélectionnez une photo.',
        400,
      );
    }

    const type =
      types[file.mimetype];

    if (!type) {
      throw new DomainError(
        'CLIENT_PHOTO_TYPE_INVALID',
        'Formats autorisés : JPG, PNG et WEBP.',
        400,
      );
    }

    if (
      !validSignature(file)
    ) {
      throw new DomainError(
        'CLIENT_PHOTO_INVALID',
        'Le contenu du fichier ne correspond pas à une image valide.',
        400,
      );
    }

    const directory =
      photoDirectory();

    await mkdir(
      directory,
      {
        recursive: true,
      },
    );

    const objectKey =
      `${randomUUID()}.${type.extension}`;

    await writeFile(
      resolve(
        directory,
        objectKey,
      ),
      file.buffer,
      {
        flag: 'wx',
      },
    );

    return {
      success: true,

      data: {
        objectKey,

        url:
          `/api/v1/client-photos/${objectKey}`,
      },
    };
  }

  @Require('clients.read')
  @Get(':filename')
  async read(
    @Param('filename')
    filename: string,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    if (
      !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(
        filename,
      )
    ) {
      throw new DomainError(
        'CLIENT_PHOTO_NOT_FOUND',
        'Photo introuvable.',
        404,
      );
    }

    const extension =
      filename
        .split('.')
        .pop()
        ?.toLowerCase();

    const contentType =
      extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : 'image/jpeg';

    const path = resolve(
      photoDirectory(),
      filename,
    );

    try {
      await stat(path);
    } catch {
      throw new DomainError(
        'CLIENT_PHOTO_NOT_FOUND',
        'Photo introuvable.',
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