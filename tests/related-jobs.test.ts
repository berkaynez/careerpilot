import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {relatedJobs} from '../src/hub/related.js';
import {demoRecords} from '../src/hub/demo.js';
import {discoveryCategories,roleProfiles,roleTerms} from '../src/discovery/role-profiles.js';
import {jobSearchQueries} from '../src/discovery/source-search.js';
const make=(company:string,title:string,country:'TR'|'GB'='TR')=>{const id=randomUUID(),seed=demoRecords()[1]!;return {...seed,id,state:'review' as const,posting:{...seed.posting,id,company,title,country}};};

test('combined role preset covers software, analysis and audit within two queries, with translated local aliases',()=>{
 const all=roleProfiles.find(value=>value.id==='all-targets')!;
 assert.equal(jobSearchQueries({roles:all.roles,locations:['Turkey']}).length,2);
 const categories=discoveryCategories(all.roles);for(const category of ['software_engineering','data_analytics','business_analysis','security','finance'])assert.ok(categories.includes(category as typeof categories[number]));
 assert.ok(roleTerms(['IT audit']).includes('technology assurance'));assert.deepEqual(discoveryCategories(['unrelated custom role']),[]);assert.ok(discoveryCategories(['product']).includes('product'));assert.ok(discoveryCategories(['backend']).includes('backend'));
});

test('related postings span sources and retain separate states; unknown companies, different roles and confirmed countries are not grouped',()=>{
 const first=make('Fictional Corp','Jr. Data Analyst'),same={...make('Fictional Corp','Junior Data Analyst'),state:'submitted' as const};
 const records=[first,same,make('Fictional Corp','Senior Product Manager'),make('Other Company','Junior Data Analyst'),make('Fictional Corp','Junior Data Analyst','GB')];
 const before=JSON.stringify(records);assert.deepEqual(relatedJobs(first,records),[{id:same.id,title:same.posting.title,state:'submitted'}]);assert.equal(JSON.stringify(records),before);
 const a=make('Fictional Bank','Banking Asset Management Software Engineer Flexible Hours'),b=make('Fictional Bank','Asset Management Software Engineer (Hybrid)');assert.equal(relatedJobs(a,[a,b]).length,1);
 const unknown=[make('Şirket doğrulanmalı','Junior Software Engineer'),make('Şirket doğrulanmalı','Junior Software Engineer')];assert.deepEqual(relatedJobs(unknown[0]!,unknown),[]);
});
