export const navigation = [
  {section:'Pilotage',href:'/dashboard',label:'Tableau de bord',permission:'reports.read'},
  {section:'Service',href:'/pos',label:'Point de vente',permission:'sales.create'},
  {section:'Service',href:'/whatsapp-orders',label:'Commandes WhatsApp',permission:'orders.manage'},
  {section:'Gestion',href:'/subscribers',label:'Abonnés',permission:'clients.read'},
  {section:'Gestion',href:'/subscriptions',label:'Abonnements',permission:'subscriptions.read'},
  {section:'Gestion',href:'/catalog',label:'Catalogue & tarifs',permission:'pricing.read'},
  {section:'Gestion',href:'/menus',label:'Menus',permission:'menus.read'},
  {section:'Gestion',href:'/stock',label:'Stock',permission:'stock.read'},
  {section:'Finances',href:'/cash',label:'Caisse & clôtures',permission:'cash.read'},
  {section:'Finances',href:'/expenses',label:'Dépenses',permission:'cash.expense'},
  {section:'Finances',href:'/reports',label:'Rapports & ventes',permission:'reports.read'},
  {section:'Finances',href:'/sales',label:'Supervision des ventes',permission:'sales.read'},
  {section:'Administration',href:'/users',label:'Utilisateurs',permission:'users.read'},
  {section:'Administration',href:'/settings',label:'Paramètres',permission:'pricing.read'},
  {section:'Administration',href:'/audit',label:'Audit',permission:'audit.read'},
] as const;
export function landingPage(permissions:string[]){if(permissions.includes('sales.create')&&!permissions.includes('reports.read'))return '/pos';return navigation.find(item=>permissions.includes(item.permission))?.href;}
export function roleLandingPage(roles:string[],permissions:string[]){if(roles.includes('CAISSIER'))return '/pos';if(roles.includes('GESTIONNAIRE'))return '/dashboard';if(roles.includes('RESPONSABLE_RESTAURANT'))return '/dashboard';return landingPage(permissions);}
