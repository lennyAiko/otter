export namespace main {
	
	export class ColumnNode {
	    name: string;
	    type: string;
	    nullable: boolean;
	    primaryKey: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ColumnNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.nullable = source["nullable"];
	        this.primaryKey = source["primaryKey"];
	    }
	}
	export class ConnectConfig {
	    host: string;
	    port: string;
	    database: string;
	    user: string;
	    password: string;
	    sslMode: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.database = source["database"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.sslMode = source["sslMode"];
	    }
	}
	export class ConnectionInfo {
	    serverVersion: string;
	    database: string;
	    user: string;
	    schemas: string[];
	
	    static createFrom(source: any = {}) {
	        return new ConnectionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverVersion = source["serverVersion"];
	        this.database = source["database"];
	        this.user = source["user"];
	        this.schemas = source["schemas"];
	    }
	}
	export class ConnectionProfile {
	    id: string;
	    name: string;
	    host: string;
	    port: string;
	    database: string;
	    user: string;
	    sslMode: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.database = source["database"];
	        this.user = source["user"];
	        this.sslMode = source["sslMode"];
	    }
	}
	export class TableNode {
	    name: string;
	    columns: ColumnNode[];
	
	    static createFrom(source: any = {}) {
	        return new TableNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.columns = this.convertValues(source["columns"], ColumnNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SchemaNode {
	    name: string;
	    tables: TableNode[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.tables = this.convertValues(source["tables"], TableNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TableRequest {
	    schema: string;
	    table: string;
	    filter: string;
	    sortColumn: string;
	    sortDesc: boolean;
	    page: number;
	    pageSize: number;
	
	    static createFrom(source: any = {}) {
	        return new TableRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.filter = source["filter"];
	        this.sortColumn = source["sortColumn"];
	        this.sortDesc = source["sortDesc"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	    }
	}
	export class TableRows {
	    columns: string[];
	    rows: any[][];
	    total: number;
	    page: number;
	    pageSize: number;
	    pageCount: number;
	
	    static createFrom(source: any = {}) {
	        return new TableRows(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	        this.total = source["total"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.pageCount = source["pageCount"];
	    }
	}

}

