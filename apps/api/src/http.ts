import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@jami/database';
import { ZodError } from 'zod';
import { Request, Response } from './transport';
export class DomainError extends HttpException { constructor(public readonly code: string, message: string, status = 409) { super({ success: false, error: { code, message } }, status); } }
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx=host.switchToHttp(),req=ctx.getRequest<Request>(),res=ctx.getResponse<Response>();
    const requestId=req.headers['x-request-id']??crypto.randomUUID();
    if(exception instanceof ZodError){res.status(400).json({success:false,error:{code:'VALIDATION_ERROR',message:'Vérifiez les champs saisis.',fields:exception.flatten()},requestId});return;}
    if(exception instanceof Prisma.PrismaClientKnownRequestError){
      const safeText=(value:string,max=500)=>value
        .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi,'[redacted-db-url]')
        .replace(/(DATABASE_URL\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
        .replace(/((?:password|passwd|pwd|token|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
        .slice(0,max);
      const allowedMeta=exception.code==='P2010'
        ? ['code','message','modelName','target','field_name','constraint']
        : ['modelName','target','field_name','constraint'];
      const safeMeta = exception.meta ? Object.fromEntries(Object.entries(exception.meta)
        .filter(([key]) => allowedMeta.includes(key))
        .map(([key,value])=>[key,typeof value==='string'?safeText(value):Array.isArray(value)?value.filter((entry):entry is string=>typeof entry==='string').map(entry=>safeText(entry,160)).slice(0,10):value])) : undefined;
      const isRawQueryFailure=exception.code==='P2010';
      this.logger.error(JSON.stringify({event:'prisma_request_error',requestId,method:req.method,route:req.route?.path??req.url?.split('?')[0],code:exception.code,...(isRawQueryFailure?{message:safeText(exception.message,1000)}:{}),meta:safeMeta}));
      const known:Record<string,{status:number;code:string;message:string}>={
        P2002:{status:409,code:'UNIQUE_CONFLICT',message:'Une donnée identique existe déjà.'},
        P2003:{status:409,code:'RELATED_DATA_UNAVAILABLE',message:'Une donnée liée à cette opération n’est plus disponible.'},
        P2025:{status:404,code:'NOT_FOUND',message:'Élément introuvable.'},
        P2034:{status:409,code:'TRANSACTION_CONFLICT',message:'La commande a été modifiée simultanément. Réessayez.'},
      };
      const mapped=known[exception.code]??{status:409,code:'DATA_CONFLICT',message:'Les données de la commande ont changé. Actualisez le menu et réessayez.'};
      res.status(mapped.status).json({success:false,error:{code:mapped.code,message:mapped.message},requestId});return;
    }
    const status=exception instanceof HttpException?exception.getStatus():500;
    const body=exception instanceof HttpException?exception.getResponse():{success:false,error:{code:'INTERNAL_ERROR',message:'Une erreur interne est survenue.'}};
    res.status(status).json({...(typeof body==='object'?body:{success:false,error:{code:'HTTP_ERROR',message:body}}),requestId});
  }
}
