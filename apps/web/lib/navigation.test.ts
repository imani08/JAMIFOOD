import {expect,it} from 'vitest';
import {navigation,landingPage,roleLandingPage} from './navigation';
import {hasPageAccess as routeAllowed} from './route-access';
it('denies direct routes without permission and unknown paths',()=>{
  for(const route of navigation){expect(routeAllowed(route.href,[])).toBe(false);expect(routeAllowed(route.href,[route.permission])).toBe(true);}
  expect(routeAllowed('/unknown',['users.read'])).toBe(false);
  expect(routeAllowed('/kitchen',['orders.read'])).toBe(false);
  expect(routeAllowed('/delivery',['orders.read'])).toBe(false);
  expect(landingPage(['sales.create'])).toBe('/pos');
  expect(roleLandingPage(['CAISSIER'],['sales.create','reports.read','users.read'])).toBe('/pos');
  expect(landingPage(['users.read'])).toBe('/users');
});
