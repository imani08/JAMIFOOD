'use client';
import { useState } from 'react';
import { api, date, money } from '../../lib/api';
import { Feedback, Heading, Loading, useAction, useData } from '../../components/common';
import { useUser } from '../../components/shell';
type Payment={id:string;method:string;status:string;receivedAmount:string;receivedCurrency:string;changeAmount:string;changeCurrency:string;exchangeRateSnapshot:string|null};
type Order={id:string;number:string;status:string;createdAt:string;serviceMode:string;totalAmount:string;currency:string;items:{id:string;quantity:string;lineTotal:string;productSnapshot:{name:string}}[];payments:Payment[]};
export default function Orders(){const [q,setQ]=useState(''),[page,setPage]=useState(1),[receipt,setReceipt]=useState<Order|null>(null);const [
  isDuplicate,
  setIsDuplicate,
] = useState(false);const orders=useData<Order[]>('/orders?page='+page+'&q='+encodeURIComponent(q));

const session =
  useData<{ id: string } | null>(
    '/cash',
  );

const a = useAction();
const user = useUser();

return <><div className="no-print"><Heading title="Commandes & paiements" subtitle="Un numéro unique, de la caisse à la remise du repas."/><Feedback {...a}/><label>Rechercher un numéro de commande<input value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="CMD-…"/></label><Loading loading={orders.isLoading} error={orders.error}/><section className="card table-wrap"><table><thead><tr><th>Commande</th><th>Date</th><th>Total</th><th>État</th><th>Paiement</th><th>Document</th></tr></thead><tbody>{orders.data?.map(o=><tr key={o.id}><td><strong>{o.number}</strong></td><td>{date(o.createdAt)}</td><td>{money(o.totalAmount,o.currency)}</td><td>{o.status}</td><td>
  {o.payments.map((p) => (
    <div
      key={p.id}
      className="section"
    >
      <div>
        <strong>
          {p.method}
        </strong>
        {' · '}
        {p.status}
      </div>

      {p.status === 'PENDING' &&
        user?.permissions.includes(
          'payments.confirm',
        ) && (
          <button
            type="button"
            className="secondary"
            disabled={a.busy}
            onClick={() => {
              if (
                window.confirm(
                  'Avez-vous vérifié la réception effective du paiement auprès du fournisseur ?',
                )
              ) {
                a.run(() =>
                  api(
                    '/orders/payments/' +
                      p.id +
                      '/confirm',
                    {},
                  ),
                );
              }
            }}
          >
            Confirmer après vérification
          </button>
        )}

      {p.status === 'CONFIRMED' &&
        user?.permissions.includes(
          'cash.refund',
        ) && (
          <button
            type="button"
            className="secondary"
            disabled={
              a.busy ||
              !session.data
            }
            onClick={() => {
              const amount =
                window.prompt(
                  `Montant à rembourser en ${p.receivedCurrency}`,
                );

              if (!amount) {
                return;
              }

              const reason =
                window.prompt(
                  'Motif du remboursement :',
                );

              if (
                !reason ||
                reason.trim().length < 5
              ) {
                window.alert(
                  'Le motif doit contenir au moins 5 caractères.',
                );

                return;
              }

              if (
                !window.confirm(
                  `Confirmer le remboursement de ${amount} ${p.receivedCurrency} ?`,
                )
              ) {
                return;
              }

              a.run(
                () =>
                  api(
                    '/orders/payments/' +
                      p.id +
                      '/refund',
                    {
                      cashSessionId:
                        session.data!.id,

                      amount,

                      reason,
                    },
                  ),
                'Remboursement enregistré.',
              );
            }}
          >
            Rembourser
          </button>
        )}
    </div>
  ))}
</td></tr>)}</tbody></table>{!orders.data?.length&&<p className="empty">Aucune commande.</p>}</section><div className="actions"><button className="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Précédent</button><span>Page {page}</span><button className="secondary" disabled={(orders.data?.length??0)<25} onClick={()=>setPage(page+1)}>Suivant</button></div></div>{receipt&&<section className="card section receipt"><h2>JAMI FOOD</h2><p>
  REÇU CLIENT
  {isDuplicate
    ? ' · DUPLICATA'
    : ''}
</p><strong>{receipt.number}</strong><p>{date(receipt.createdAt)} · {receipt.serviceMode ===
'DINE_IN'
  ? 'Sur place'
  : receipt.serviceMode ===
      'TAKEAWAY'
    ? 'À emporter'
    : 'Livraison'}</p><hr/>{receipt.items.map(i=><p key={i.id}>{i.quantity} × {i.productSnapshot.name}<br/>{money(i.lineTotal,receipt.currency)}</p>)}<hr/><strong>Total : {money(receipt.totalAmount,receipt.currency)}</strong>{receipt.payments.filter(p=>p.status==='CONFIRMED').map(p=><div key={p.id}><p>Reçu : {money(p.receivedAmount,p.receivedCurrency)} · {p.method}</p>{p.exchangeRateSnapshot&&<p>Taux appliqué : 1 USD = {p.exchangeRateSnapshot} CDF</p>}<p>Rendu : {money(p.changeAmount,p.changeCurrency??receipt.currency)}</p></div>)}<p>PAYÉ · Présentez votre numéro à la cuisine.</p><button className="primary" onClick={()=>window.print()}>Imprimer / PDF</button><button className="secondary" onClick={() => {
  setReceipt(null);
  setIsDuplicate(false);
}}>Fermer</button></section>}</>;}
