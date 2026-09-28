'use client';

import {
  Feedback,
  Heading,
  Loading,
  useAction,
  useData,
} from '../../components/common';
import { useUser } from '../../components/shell';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  api,
  date,
} from '../../lib/api';

type Order = {
  id: string;
  number: string;
  status: string;
  serviceMode:string;
  createdAt: string;

  client: {
    firstName: string;
    lastName: string;
    phone: string | null;
    residency: string | null;
    ulcNumber: string | null;
  } | null;
  delivery:{status:string;addressSnapshot:Record<string,unknown>;failureReason:string|null}|null;

  kitchenTicket: {
    items: {
      id: string;
      quantity: string;

      preparationSnapshot: {
        name: string;
      };
    }[];
  } | null;
};
type Dispatch = {orders:{id:string;number:string;createdAt:string;client:{firstName:string;lastName:string}|null;delivery:{addressSnapshot:Record<string,unknown>}|null}[];couriers:{id:string;firstName:string;lastName:string;activeMissions:number;capacity:number}[]};

export default function Delivery() {
  const user=useUser();
  const q =
    useData<Order[]>('/delivery');
  const dispatch=useQuery({queryKey:['delivery-dispatch'],queryFn:()=>api<Dispatch>('/delivery/dispatch'),enabled:Boolean(user?.permissions.includes('delivery.assign'))});
  const availability=useQuery({queryKey:['delivery-availability'],queryFn:()=>api<{isCourier:boolean;availability:'AVAILABLE'|'BUSY'|'UNAVAILABLE';manualAvailability:'AVAILABLE'|'UNAVAILABLE';activeMissions:number;capacity:number}>('/delivery/availability'),enabled:Boolean(user?.permissions.includes('delivery.read'))});
  const [courierByOrder,setCourierByOrder]=useState<Record<string,string>>({});

  const a = useAction();

  return (
    <>
      <Heading
        title="Livraisons"
        subtitle="Commandes prêtes et livraisons en cours."
      />

      <Feedback {...a} />
      {availability.data?.isCourier&&<section className="card section"><div className="section-title"><h2>Mon statut livreur</h2><span className="badge">{availability.data.availability==='AVAILABLE'?'Disponible':availability.data.availability==='BUSY'?'En mission':'Indisponible'}</span></div><p className="muted small">{availability.data.activeMissions}/{availability.data.capacity} mission(s) active(s). Le statut manuel indisponible est respecté après la livraison.</p><button className="secondary" disabled={a.busy} onClick={()=>a.run(async()=>{await api('/delivery/availability',{availability:availability.data?.manualAvailability==='AVAILABLE'?'UNAVAILABLE':'AVAILABLE'});await availability.refetch();await dispatch.refetch();},availability.data.manualAvailability==='AVAILABLE'?'Vous êtes indisponible.':'Vous êtes disponible.')}>{availability.data.manualAvailability==='AVAILABLE'?'Me rendre indisponible':'Me rendre disponible'}</button></section>}

      <Loading
        loading={q.isLoading}
        error={q.error}
      />

      {user?.permissions.includes('delivery.assign')&&<section className="card dispatch-panel"><div className="section-title"><h2>À affecter</h2><span className="badge">{dispatch.data?.orders.length??0}</span></div><p className="muted small">Affectez chaque commande prête à un livreur disponible. Les livreurs ne voient que les missions qui leur sont attribuées.</p><Loading loading={dispatch.isLoading} error={dispatch.error}/>{dispatch.data?.orders.map(order=>{const snapshot=order.delivery?.addressSnapshot??{};return <div className="dispatch-row" key={order.id}><span><strong>{order.number}</strong><br/><small>{String(snapshot.recipientName??'Destinataire non renseigné')} · {String(snapshot.contactPhone??'Téléphone absent')}</small><br/><small className="muted">{String(snapshot.dropoffPoint??'Point non renseigné')} · {String(snapshot.requestedDeliveryTime??'Heure flexible')}</small></span><select aria-label={`Livreur pour ${order.number}`} value={courierByOrder[order.id]??''} onChange={event=>setCourierByOrder(value=>({...value,[order.id]:event.target.value}))}><option value="">Choisir un livreur disponible</option>{dispatch.data?.couriers.map(courier=><option key={courier.id} value={courier.id}>{courier.firstName} {courier.lastName} · {courier.activeMissions}/{courier.capacity} mission</option>)}</select><button className="secondary" disabled={a.busy||!courierByOrder[order.id]} onClick={()=>a.run(async()=>{await api(`/delivery/${order.id}/assign`,{courierId:courierByOrder[order.id]});await dispatch.refetch();},'Livraison affectée au livreur.')}>Affecter</button></div>})}{dispatch.data?.orders.length===0&&<p className="empty">Aucune commande prête à affecter.</p>}</section>}

      <div className="columns">
        {[
          {
            status: 'READY',
            title: 'À récupérer',
            next:
              'OUT_FOR_DELIVERY',
            action:
              'Départ en livraison',
          },

          {
            status:
              'OUT_FOR_DELIVERY',
            title:
              'En livraison',
            next: 'DELIVERED',
            action:
              'Confirmer la livraison',
          },
        ].map(
          ({
            status,
            title,
            next,
            action,
          }) => (
            <section
              className="card"
              key={status}
            >
              <h2>
                {title}{' '}
                <span className="badge">
                  {q.data?.filter(
                    (o) =>
                      o.status ===
                      status,
                  ).length ?? 0}
                </span>
              </h2>

              {q.data
                ?.filter(
                  (o) =>
                    o.status ===
                    status,
                )
                .map((o) => (
                  <article
                    className="card ticket"
                    key={o.id}
                  >
                    <h3>
                      {o.number}
                    </h3>

                    <p className="muted small">
                      {date(
                        o.createdAt,
                      )}
                    </p>

                    {o.client && (
                      <>
                        <strong>
                          {
                            o.client
                              .firstName
                          }{' '}
                          {
                            o.client
                              .lastName
                          }
                        </strong>

                        {o.client
                          .phone && (
                          <p>
                            Téléphone :{' '}
                            {
                              o.client
                                .phone
                            }
                          </p>
                        )}

                        {o.client
                          .residency && (
                          <p>
                            Résidence :{' '}
                            {
                              o.client
                                .residency
                            }
                          </p>
                        )}
                      </>
                    )}

                    {o.delivery&&(()=>{const s=o.delivery.addressSnapshot;return <div className="delivery-recipient"><strong>Destinataire : {String(s.recipientName??'—')}</strong><p>Téléphone : {String(s.contactPhone??'—')}</p><p>Point : {String(s.dropoffPoint??'—')} · Heure : {String(s.requestedDeliveryTime??'Flexible')}</p>{typeof s.instructions==='string'&&s.instructions&&<p>Instructions : {s.instructions}</p>}{o.delivery.failureReason&&<p className="status-warning">Échec signalé : {o.delivery.failureReason}</p>}</div>})()}

                    <hr />

                    {o.kitchenTicket?.items.map(
                      (i) => (
                        <p key={i.id}>
                          {i.quantity}
                          {' × '}
                          {
                            i
                              .preparationSnapshot
                              .name
                          }
                        </p>
                      ),
                    )}

                    <button
                      className="primary full"
                      disabled={a.busy}
                      onClick={() => {
                        if (
                          next ===
                            'DELIVERED' &&
                          !window.confirm(
                            'Confirmer que la commande a réellement été remise au client ?',
                          )
                        ) {
                          return;
                        }

                        a.run(
                          async () => {
                            await api(
                              '/delivery/' +
                                o.id +
                                '/status',
                              {
                                status:
                                  next,
                                physicallyHandedOver: next === 'DELIVERED',
                              },
                            );

                            await q.refetch();
                          },
                        );
                      }}
                    >
                      {action}
                    </button>
                    {next==='DELIVERED'&&<button className="secondary full" disabled={a.busy} onClick={()=>{const reason=window.prompt('Motif de l’échec ou du refus de livraison ?');if(!reason)return;a.run(async()=>{await api(`/delivery/${o.id}/failure`,{reason});await q.refetch();},'Échec de livraison enregistré. Le droit reste réservé.');}}>Signaler un échec ou un refus</button>}
                  </article>
                ))}

              {!q.data?.some(
                (o) =>
                  o.status ===
                  status,
              ) && (
                <p className="empty">
                  Aucune commande.
                </p>
              )}
            </section>
          ),
        )}
      </div>
    </>
  );
}
