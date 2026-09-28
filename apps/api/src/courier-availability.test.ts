import {describe,expect,it} from 'vitest';
import {courierCanAccept,effectiveCourierAvailability,rankCouriers} from './courier-availability';

describe('courier capacity and manual availability',()=>{
  it('derives BUSY while capacity is full and returns to AVAILABLE when a mission ends',()=>{
    expect(effectiveCourierAvailability('AVAILABLE',1,1)).toBe('BUSY');
    expect(effectiveCourierAvailability('AVAILABLE',0,1)).toBe('AVAILABLE');
  });
  it('keeps manual UNAVAILABLE even with no active mission',()=>{
    expect(effectiveCourierAvailability('UNAVAILABLE',0,1)).toBe('UNAVAILABLE');
    expect(courierCanAccept('UNAVAILABLE',0,1)).toBe(false);
  });
  it('allows only below-capacity AVAILABLE couriers',()=>{
    expect(courierCanAccept('AVAILABLE',0,1)).toBe(true);
    expect(courierCanAccept('AVAILABLE',1,1)).toBe(false);
  });
  it('ranks by active mission count then stable name and id',()=>{
    const ranked=rankCouriers([{id:'b',firstName:'Zed',lastName:'B',activeMissions:1},{id:'c',firstName:'Ana',lastName:'B',activeMissions:0},{id:'a',firstName:'Ana',lastName:'A',activeMissions:0}]);
    expect(ranked.map(row=>row.id)).toEqual(['a','c','b']);
  });
});
