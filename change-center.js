(function(root) {
    'use strict';
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
    function equal(a,b) {
        if (!a || !b) return a===b;
        if (!!a.deleted!==!!b.deleted || !!a.created!==!!b.created) return false;
        if (!a.incomplete && !b.incomplete && typeof a.text==='string' && typeof b.text==='string') return a.text===b.text;
        return a.signature===b.signature;
    }
    class ChangeController {
        constructor({limit=40,onChange=()=>{},now=()=>Date.now()}={}) {
            this.documents=new Map(); this.active=null; this.operation=null;
            this.limit=limit; this.onChange=onChange; this.now=now;
        }
        has(id) { return this.documents.has(id); }
        get(id=this.active) { return this.documents.get(id); }
        emit() { this.onChange(this); }
        open(id,snapshot,{label=id,kind='config',revision=''}={}) {
            if(!this.has(id)) this.documents.set(id,{id,label,kind,revision,saved:copy(snapshot),draft:copy(snapshot),undo:[],redo:[],group:null,at:0,applied:null,applyState:null});
            this.active=id;this.emit();return this.get(id);
        }
        activate(id) { this.active=this.has(id)?id:null;this.emit(); }
        change(id,snapshot,{group=null}={}) {
            const doc=this.get(id);if(!doc)return false;
            if(equal(doc.draft,snapshot)) {doc.draft=copy(snapshot);return false;}
            const now=this.now();
            if(!group || doc.group!==group || now-doc.at>500) {
                doc.undo.push(copy(doc.draft));if(doc.undo.length>this.limit)doc.undo.shift();
            }
            doc.draft=copy(snapshot);doc.redo=[];doc.group=group;doc.at=now;this.emit();return true;
        }
        boundary(id=this.active) {const doc=this.get(id);if(doc)doc.group=null;}
        move(from,to,id=this.active) {
            const doc=this.get(id);if(!doc || !doc[from].length || this.operation)return null;
            doc[to].push(copy(doc.draft));if(doc[to].length>this.limit)doc[to].shift();
            doc.draft=doc[from].pop();doc.group=null;this.emit();return copy(doc.draft);
        }
        undo(id) {return this.move('undo','redo',id);}
        redo(id) {return this.move('redo','undo',id);}
        dirty(id=this.active) {const doc=this.get(id);return !!doc && !equal(doc.saved,doc.draft);}
        dirtyCount() {return [...this.documents.keys()].filter(id=>this.dirty(id)).length;}
        discard(id=this.active) {
            const doc=this.get(id);if(!doc||this.operation)return null;
            this.change(id,doc.saved);this.boundary(id);return copy(doc.draft);
        }
        saved(id,snapshot,revision) {
            const doc=this.get(id);if(!doc)return;
            doc.saved=copy(snapshot);doc.savedInSession=true;if(revision!==undefined)doc.revision=revision;
            doc.group=null;this.emit();
        }
        applyState(id,state,target) {
            const doc=this.get(id);if(!doc)return;
            doc.applyState=state;
            if(state==='COMMITTED' && typeof target==='string')doc.applied=target;
            this.emit();
        }
        forget(id) {this.documents.delete(id);if(this.active===id)this.active=null;this.emit();}
        begin(kind) {if(this.operation)return false;this.operation=kind;this.emit();return true;}
        end() {this.operation=null;this.emit();}
    }
    root.ChangeController=ChangeController;
    if(typeof module!=='undefined')module.exports={ChangeController,equal};
})(typeof window!=='undefined'?window:globalThis);
