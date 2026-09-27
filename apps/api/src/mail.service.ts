import { Injectable, Logger } from '@nestjs/common';
import { connect as connectTls, TLSSocket } from 'node:tls';
import { connect as connectNet, Socket } from 'node:net';
import { createInterface, Interface } from 'node:readline';

type MailSocket = Socket | TLSSocket;

/** Small SMTP client for transactional plain-text messages; supports implicit TLS and STARTTLS. */
async function smtpSend(to:string, subject:string, text:string) {
  const host=process.env.SMTP_HOST, from=process.env.MAIL_FROM;
  const port=Number(process.env.SMTP_PORT??(process.env.SMTP_SECURE==='true'?465:587));
  if(!host||!from||!Number.isInteger(port)||port<1||port>65535) throw new Error('Configuration SMTP incomplète.');
  let socket:MailSocket=await new Promise((resolve,reject)=>{const s=process.env.SMTP_SECURE==='true'?connectTls({host,port,servername:host},()=>resolve(s)):connectNet({host,port},()=>resolve(s));s.once('error',reject);});
  socket.setTimeout(15_000,()=>socket.destroy(new Error('Délai SMTP dépassé.')));
  let lines:Interface=createInterface({input:socket});
  const reply=async()=>{const response:string[]=[];for await(const line of lines){response.push(line);if(/^\d{3} /.test(line))return response.join('\n');}throw new Error('Réponse SMTP interrompue.');};
  const command=async(value:string,expected:number[])=>{socket.write(`${value}\r\n`);const line=await reply();const status=Number(line.slice(0,3));if(!expected.includes(status))throw new Error(`Réponse SMTP inattendue (${status}).`);return line;};
  try {
    const greeting=await reply();if(!greeting.startsWith('220'))throw new Error('Serveur SMTP indisponible.');
    const hello=await command(`EHLO ${process.env.SMTP_HELO??'jami-food.local'}`,[250]);
    if(process.env.SMTP_SECURE!=='true'&&/STARTTLS/i.test(hello)) {
      await command('STARTTLS',[220]);lines.close();socket=await new Promise((resolve,reject)=>{const s=connectTls({socket:socket as Socket,servername:host},()=>resolve(s));s.once('error',reject);});socket.setTimeout(15_000,()=>socket.destroy(new Error('Délai SMTP dépassé.')));lines=createInterface({input:socket});await command(`EHLO ${process.env.SMTP_HELO??'jami-food.local'}`,[250]);
    }
    const user=process.env.SMTP_USER,password=process.env.SMTP_PASSWORD;
    if(user&&process.env.SMTP_SECURE!=='true'&&!/STARTTLS/i.test(hello))throw new Error('SMTP auth requires TLS.');
    if(user||password){if(!user||!password)throw new Error('Identifiants SMTP incomplets.');await command('AUTH LOGIN',[334]);await command(Buffer.from(user).toString('base64'),[334]);await command(Buffer.from(password).toString('base64'),[235]);}
    const address=(value:string)=>value.match(/<([^<>]+)>/)?.[1]??value;
    await command(`MAIL FROM:<${address(from)}>`,[250]);await command(`RCPT TO:<${address(to)}>`,[250,251]);await command('DATA',[354]);
    const body=text.replace(/\r?\n/g,'\r\n').replace(/^\./gm,'..');
    const encodedSubject=`=?UTF-8?B?${Buffer.from(subject,'utf8').toString('base64')}?=`;
    socket.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n.\r\n`);
    const accepted=await reply();if(!accepted.startsWith('250'))throw new Error('Le serveur SMTP a refusé le message.');await command('QUIT',[221]);
  } finally {lines.close();socket.end();}
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendVerificationEmail(to: string, token: string) {
    const url = this.url('/verify-email', token);
    return this.send(to, 'Vérifiez votre compte JAMI FOOD', `Bonjour,\n\nVérifiez votre adresse e-mail en ouvrant ce lien (valable 30 minutes) :\n${url}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`);
  }

  async sendPortalInvitation(to: string, name: string, token: string) {
    const url = this.url('/activate-account', token);
    return this.send(to, 'Activez votre compte JAMI FOOD', `Bonjour ${name},\n\nVotre accès au portail client JAMI FOOD a été créé. Choisissez votre mot de passe et vérifiez votre adresse e-mail avec ce lien (valable 24 heures) :\n${url}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`);
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const url = this.url('/reset-password', token);
    return this.send(to, 'Réinitialisation du mot de passe — JAMI FOOD', `Une demande de réinitialisation a été faite. Le lien expire dans 20 minutes :\n${url}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`);
  }

  private url(path: string, token: string) {
    const base = process.env.CLIENT_PUBLIC_URL ?? process.env.CLIENT_APP_URL ?? 'http://localhost:3002';
    return `${base.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  private async send(to: string, subject: string, text: string) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (key && from) {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }) });
      if (!response.ok) { this.logger.error('Le fournisseur e-mail a refusé un message transactionnel.'); return { sent: false as const }; }
      return { sent: true as const };
    }
    if(process.env.SMTP_HOST&&from) {
      try { await smtpSend(to,subject,text); return {sent:true as const}; }
      catch { this.logger.error('L’envoi transactionnel SMTP a échoué.'); return {sent:false as const}; }
    }
    if (process.env.MAIL_MODE === 'development' && process.env.NODE_ENV !== 'production') {
      this.logger.warn('Mode e-mail développement : aucun message envoyé.');
      return { sent: false as const, developmentUrl: text.match(/https?:\/\/[^\s]+/)?.[0] };
    }
    this.logger.warn('E-mail non envoyé : aucun fournisseur configuré.');
    return { sent: false as const };
  }
}
