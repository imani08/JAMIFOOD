'use client';
import { ReactNode, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
export function useData<T>(path:string){return useQuery({queryKey:[path],queryFn:()=>api<T>(path)});}
export function useAction(){const client=useQueryClient();const running=useRef(false);const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);return {error,notice,busy,run:async<T,>(work:()=>Promise<T>,success='Opération enregistrée.')=>{if(running.current)return undefined;running.current=true;setError('');setNotice('');setBusy(true);try{const data=await work();setNotice(success);await client.invalidateQueries();return data;}catch(e){setError(e instanceof Error?e.message:'Une erreur est survenue.');return undefined;}finally{running.current=false;setBusy(false);}}};}
export function Feedback({error,notice}:{error?:string;notice?:string}){return <>{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="success">{notice}</p>}</>;}
export function Heading({title,subtitle,children}:{title:string;subtitle:string;children?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">JAMI FOOD · RESTAURANT ULC</p><h1>{title}</h1><p className="muted" style={{margin:0}}>{subtitle}</p></div>{children}</div>;}
export function Loading({loading,error}:{loading:boolean;error:Error|null}){return <>{loading&&<div className="loading">Chargement…</div>}{error&&<p className="error" role="alert">{error.message}</p>}</>;}
export function Field({label,name,type='text',required=true,defaultValue}:{label:string;name:string;type?:string;required?:boolean;defaultValue?:string}){return <label>{label}<input name={name} type={type} required={required} defaultValue={defaultValue} step={type==='number'?'0.01':undefined} min={type==='number'?'0':undefined}/></label>;}
export function formValues(form:HTMLFormElement){return Object.fromEntries(new FormData(form).entries()) as Record<string,string>;}
