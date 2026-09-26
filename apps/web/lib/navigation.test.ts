import {expect,it} from 'vitest';
import {navigation,landingPage} from './navigation';
import {hasPageAccess as routeAllowed} from './route-access';
it('denies direct routes without permission and unknown paths',()=>{
  for(const route of navigation.filter(item=>item.href!=='/')){expect(routeAllowed(route.href,[])).toBe(false);expect(routeAllowed(route.href,[route.permission])).toBe(true);}
  expect(routeAllowed('/unknown',['users.read'])).toBe(false);
  expect(routeAllowed('/reports',['delivery.read'])).toBe(false);
  expect(landingPage(['delivery.read'])).toBe('/delivery');
  expect(landingPage(['users.read'])).toBe('/users');
});
