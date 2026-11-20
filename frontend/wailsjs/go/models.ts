export namespace main {
	
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

}

