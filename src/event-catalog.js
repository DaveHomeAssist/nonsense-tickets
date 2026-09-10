(function exposeEventCatalog(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * The show catalog: the one place an event is defined for the storefront.
   *
   * Every surface that names a show reads from here: discovery cards, the
   * detail sheet, the checkout math, calendar export, and the tests. Nothing
   * else may carry its own copy of a title, price, date, or sale status.
   *
   * Every entry must satisfy NonsenseEventTools.validateEvent. Roadmap item 6
   * replaces this object with a persisted data layer; the shape stays.
   *
   * Entries 1 to 6 are prototype fixtures. Entry 7 is sourced from the
   * official AfterBreak 2026 listing and sells externally on Linkstub.
   * ------------------------------------------------------------------ */

  const events = {
    1:{art:'assets/stage-crowd.png',banner:'assets/stage-crowd.png',genre:'techno',title:'Concrete Mass 014',venue:'Callowhill warehouse · address on ticket',startsAt:'2026-09-04T22:00:00-04:00',endsAt:'2026-09-05T04:00:00-04:00',timeZone:'America/New_York',price:20,tag:'on',
       lineup:['VOID CADET (Berlin)','Slag Density','Perimeter b2b Fault Line'],note:'21+ · BYO earplugs · no photos on the floor'},
    2:{art:'assets/stage-lounge.png',banner:'assets/stage-lounge.png',genre:'house',title:'Sweat Equity',venue:'Fishtown Social Club',startsAt:'2026-09-05T21:00:00-04:00',endsAt:'2026-09-06T02:00:00-04:00',timeZone:'America/New_York',price:15,tag:'low',
       lineup:['MISS DIRECT','Terrace Logic','Houseplant (live)'],note:'21+ · rooftop opens at midnight'},
    3:{art:'assets/stage-kraken.png',banner:'assets/stage-kraken.png',genre:'bass',title:'Low End Census',venue:'The Substation · Kensington',startsAt:'2026-09-11T22:00:00-04:00',endsAt:'2026-09-12T03:00:00-04:00',timeZone:'America/New_York',price:18,tag:'on',
       lineup:['SUBFLOOR','Gutter Pressure','Hexwave'],note:'18+ · Funktion One rig'},
    4:{art:'assets/stage-truss.png',banner:'assets/stage-truss.png',genre:'dnb',title:'Fast Forward Philly',venue:'Ukrainian Social Hall',startsAt:'2026-09-12T21:00:00-04:00',endsAt:'2026-09-13T02:00:00-04:00',timeZone:'America/New_York',price:22,tag:'on',
       lineup:['TEMPO CRIMES (UK)','Breakneck','Junglist Union DJs'],note:'21+ · 170bpm minimum'},
    5:{art:'assets/dj-frame.png',banner:'assets/dj-frame.png',genre:'techno',title:'Night Shift: All Vinyl',venue:'Basement TBA · West Philly',startsAt:'2026-09-18T23:00:00-04:00',endsAt:'2026-09-19T05:00:00-04:00',timeZone:'America/New_York',price:12,tag:'low',
       lineup:['GRAVEYARD ROTATION','Loading Dock','Third Rail'],note:'21+ · address texted day of show'},
    6:{genre:'bass',art:'assets/afterjinx-logo.png',banner:'assets/afterjinx-flyer.png',title:'Afterjinx After Hours',venue:'No Nonsense · 405 N Broad St',startsAt:'2026-12-26T01:00:00-05:00',endsAt:'2026-12-26T03:00:00-05:00',timeZone:'America/New_York',price:25,tag:'soldout',
       lineup:['DEFUNK','FRESH BVKED','JAML','DR.FUNKLE b2b NEUROMANCY'],note:'Presented by No Nonsense · Hijinx unofficial afterparty · sold out'},
    7:{art:'assets/nn-logo.png',genre:'edm',title:'AfterBreak 2026',venue:'Secret location · revealed day of event',startsAt:'2026-09-11T23:45:00-04:00',endsAt:'2026-09-13T06:30:00-04:00',timeZone:'America/New_York',price:25,tag:'external',
       sessions:[{id:'night-1',label:'Night 1',startsAt:'2026-09-11T23:45:00-04:00'},{id:'night-2',label:'Night 2',startsAt:'2026-09-12T23:45:00-04:00'}],
       offers:[{id:'night-1-early-bird',label:'GA Night 1 · Early Bird',facePrice:25,externalTotal:29.77,sessionIds:['night-1']},{id:'night-2-early-bird',label:'GA Night 2 · Early Bird',facePrice:25,externalTotal:29.77,sessionIds:['night-2']},{id:'combo-early-bird',label:'GA Night 1 + 2 Combo · Early Bird',facePrice:40,externalTotal:46.25,sessionIds:['night-1','night-2']}],
       checkout:{mode:'external',provider:'Linkstub',url:'https://linkstub.com/en/ab26'},lineup:['Full lineup TBA','',''],note:'18+ to enter · 21+ to party · valid ID required'}
  };

  /* Sale-status vocabulary the storefront renders from `tag`. */
  const TAGS = Object.freeze(['on', 'low', 'soldout', 'external']);

  root.NonsenseEventCatalog = Object.freeze({
    TAGS,
    events: Object.freeze(events)
  });
})(globalThis);
