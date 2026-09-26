import { ComingSoon } from '../../ui';
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) { await params; return <ComingSoon title="Suivi de commande" detail="Les détails et l’avancement seront visibles ici après authentification ou avec un lien de suivi sécurisé."/>; }
