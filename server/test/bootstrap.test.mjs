import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapAdmin} from '../bootstrap-admin.mjs';
import {createStore} from '../core.mjs';

test('First administrator is provisioned once and cannot be overwritten by deployment variables',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tacl-bootstrap-')),path=join(dir,'test.sqlite');
  try {
    assert.equal(bootstrapAdmin(path,{}),false);
    assert.throws(()=>bootstrapAdmin(path,{ADMIN_EMAIL:'admin@example.test'}));
    assert.equal(bootstrapAdmin(path,{ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'test-password-123'}),true);
    assert.equal(bootstrapAdmin(path,{ADMIN_EMAIL:'other@example.test',ADMIN_PASSWORD:'replacement-password-123'}),false);
    const store=createStore(path);
    try {
      assert.equal(store.login('admin@example.test','test-password-123').user.role,'admin');
      assert.throws(()=>store.login('other@example.test','replacement-password-123'),{status:401});
    }finally{store.db.close()}
  }finally{rmSync(dir,{recursive:true,force:true})}
});
