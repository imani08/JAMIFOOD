import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@jami/database';
import { ZodError } from 'zod';
import { Request, Response } from './transport';
export class DomainError extends HttpException { constructor(public readonly code: string, message: string, status = 409) { super({ success: false, error: { code, message } }, status); } }
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx=host.switchToHttp(),req=ctx.getRequest<Request>(),res=ctx.getResponse<Response>();
    const requestId=req.headers['x-request-id']??crypto.randomUUID();
    if(exception instanceof ZodError){res.status(400).json({success:false,error:{code:'VALIDATION_ERROR',message:'Vérifiez les champs saisis.',fields:exception.flatten()},requestId});return;}
    if(exception instanceof Prisma.PrismaClientKnownRequestError){const missing=exception.code==='P2025';res.status(missing?404:409).json({success:false,error:{code:missing?'NOT_FOUND':'DATA_CONFLICT',message:missing?'Élément introuvable.':'Opération en conflit avec une donnée existante. Vérifiez les doublons ou réessayez.'},requestId});return;}
    const status=exception instanceof HttpException?exception.getStatus():500;
    const body=exception instanceof HttpException?exception.getResponse():{success:false,error:{code:'INTERNAL_ERROR',message:'Une erreur interne est survenue.'}};
    res.status(status).json({...(typeof body==='object'?body:{success:false,error:{code:'HTTP_ERROR',message:body}}),requestId});
  }
}
