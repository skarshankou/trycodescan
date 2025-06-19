/**********************************************************************
* Company : Skybuffer AS (Norway)
* Email : support@skybuffer.com
* Web : www.skybuffer.com
*
* Created by : Dzmity Salavei, Artsiom Stsepaniuk
*
* Add-on ID : ...
* Add-on name : ...
*
* Version : 1.3
* Purpose : train_deploy_processor: Deploing trained NLU models
*
* History : 1.0 - initial version 2024-02-23
*			1.1 - NLP Models Synchronization from DB to Prediction Server 2024-04-15
*           1.2 - notification added 2024-05-21 Dzmity Salavei
*           1.3 - intents strictness 2024-07-09 Dzmity Salavei
*  
*********************************************************************/

var { options: serverOptions, fetchAxios: fetchAxios, FormData: FormData } = $.require('../../../server');

var axios = await fetchAxios();
//var formData = new FormData();

//console.log('----- axios in jobDeploy:', axios );

await $.import("xsjs.coreLibs", "commonTools");
await $.import("xsjs.coreLibs", "dbTools");
await $.import("xsjs.coreLibs", "netTools");
await $.import("xsjs.coreLibs", "tokenTools");
const commonTools = $.xsjs.coreLibs.commonTools;
const dbTools = $.xsjs.coreLibs.dbTools;
const netTools = $.xsjs.coreLibs.netTools;
const tokenTools =  $.xsjs.coreLibs.tokenTools;

//---------------------------------------- The end of import block

var rows2Process = 1; //max number of rows processed at one time in status 4

var jsonObjectOut = {};
    jsonObjectOut.ErrorCode = 0;
    jsonObjectOut.ErrorText = '';
    jsonObjectOut.Logs = []; 

try {
	var connectionHDB = await $.hdb.getConnection();
	
    console.log('--- Job Deploy');
    jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} START`);
//---------------------------------------

//console.log('--- serverOptions :', serverOptions);
const clientId = serverOptions.uaa.clientid.toString();
const clientSecret = serverOptions.uaa.clientsecret.toString(); 
//const clientId = "sb-SKYBFRYAI!i2" //DEBUG ONLY !!!!
//const clientSecret = "nDb6GxxN+E1Ap/2QmCg+gp/cg+wDkE0ea3MVmBndEEJf32cmMw2o+sqSew2jOaXv+j2NLAt1+TYU\nKs9EwsUY4A==" //DEBUG ONLY !!!!
const urlUAA = serverOptions.uaa.url.toString();

//console.log('--- serverOptions.uaa: ', serverOptions.uaa);

//----------------------------------------
    let status = '4';
    let resultStatus = await dbTools.getStatusRows( connectionHDB, rows2Process, status);
    
    for (let i = 0; i < resultStatus.length; i++) {
		
		let row = resultStatus[i];
		if (row && row.APP_GUID) {
			const userName = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'TECHNICAL_USER_NAME' );
			const userPassword = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'TECHNICAL_USER_PASSWORD' );
			
			var tokenJSON = tokenTools.tokenUAA;
			await tokenJSON.getSavedToken();
			let tokenIsExpired = await tokenJSON.tokenIsExpired();
			if ( tokenIsExpired ) {
				await tokenJSON.getNewToken(urlUAA, clientId, clientSecret, userName, userPassword);
			} 
			
			jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} --- ${commonTools.getLogRow(status,row)}`);
			
			// get Configuration.AI for row tenant
			let predictHost = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'PREDICT_HOST' );
			let predictPort = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'PREDICT_PORT' );
			let predictUrl = predictPort === '' ? predictHost : predictHost + ':' + predictPort  ;
			
			console.log('--- predictUrl: ', predictUrl)
				
			if (!commonTools.isValidUrl(predictUrl)) {
				jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} URL ( ${predictUrl} ) is not correct.`
					+ `It must begins with "http" or "https" followed by "://" and then any characters other than spaces."`);
					
				await dbTools.addNotification(connectionHDB, row.TENANTID, row.BOT_GUID, 'E' , 'Prediction server not found', `URL ( ${predictUrl} ) is not correct.`);	
			} else {
				// GET request to train/model/status
				console.log('--- tokenJSON.autorization.length: ', tokenJSON.autorization.length)
				let responseJSON = await netTools.getModelStatus(predictUrl, row.MODEL_GUID, false, tokenJSON.autorization);
				
				if (responseJSON.status==401) {
					await tokenJSON.getNewToken(urlUAA, clientId, clientSecret, userName, userPassword);
					responseJSON = await netTools.getModelStatus(predictUrl, row.MODEL_GUID, false, tokenJSON.autorization);
				}
				
				let serverStatus =  responseJSON.SERVER_STATUS;
				console.log('--- SERVER_STATUS : ', serverStatus );
				jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} CODE = ${responseJSON.status} ; SERVER_STATUS = ${serverStatus}`);
				// if SERVER_STATUS = 1 then
				if (serverStatus == '4') {
					jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} trying to deploy model... `);	
					
					//Geting models from DB 
					let resultModels = await dbTools.getModelFiles( connectionHDB, row.TENANTID, row.BOT_GUID, row.MODEL_GUID );
					console.log('--- DEPLOYING MODEL_TYPE_ID : ', row.MODEL_TYPE_ID);
					// POST Request to send TRAINED_FILE and FILE_DATA 
					responseJSON = await netTools.deployModelAxios(
						axios, 
						FormData,
						predictUrl,
						row.BOT_GUID,
						row.MODEL_GUID,
						row.MODEL_TYPE_ID,
						tokenJSON.autorization,
						resultModels[0].TRAINED_FILE,
						resultModels[0].FILE_DATA);
					
					// if no error then
					let txt = responseJSON.error != '' ? ` ERROR: ${responseJSON.error} ` : '' ;
					jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} CODE: ${responseJSON.status} ${txt} `);	
					
					if ( responseJSON.error != '' ) {
						await dbTools.addNotification(connectionHDB, row.TENANTID, row.BOT_GUID, 'E' , 'Prediction server error', `${responseJSON.error} \nRetry will be performed automatically.`);							
					}
					
				} else {
					
					if (serverStatus == '5') {
						console.log('--- Model is already being deployed : ');
						let cnt = await dbTools.setStatusId(connectionHDB, '5', row.TENANTID, row.BOT_GUID, row.MODEL_GUID);
						jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} Updated ${cnt} model into status 5`);
						await dbTools.addNotification(connectionHDB, row.TENANTID, row.BOT_GUID, 'N' , 'Deploying finished successfully', `Model ${row.MODEL_GUID} deployed.`);
					} else {
						
						if (serverStatus == '0') {
							console.log('--- Server is busy ');	
							jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} Server is busy`);
						}
						
					}
					
				}
				
			}
				
		}  else {
			if (row && !row.APP_GUID) {
			    console.error(`APP_GUID is missing or falsy for row: TENANTID = ${row.TENANTID}, BOT_GUID = ${row.BOT_GUID}, MODEL_GUID = ${row.MODEL_GUID}`);
			    jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} APP_GUID is missing or falsy for row: TENANTID = ${row.TENANTID}, BOT_GUID = ${row.BOT_GUID}, MODEL_GUID = ${row.MODEL_GUID}`);
			}
			
		}  	
		
    }
    
    //Status synchronization
    status = '5';
    rows2Process = 10;
    resultStatus = await dbTools.getStatusRows( connectionHDB, rows2Process, status);
    
    for (let i = 0; i < resultStatus.length; i++) {
    	let row = resultStatus[i];
    	
    	if (row && row.APP_GUID) {
    		const userName = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'TECHNICAL_USER_NAME' );
			const userPassword = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'TECHNICAL_USER_PASSWORD' );
			
			var tokenJSON = tokenTools.tokenUAA;
			await tokenJSON.getSavedToken();
			let tokenIsExpired = await tokenJSON.tokenIsExpired();
			if ( tokenIsExpired ) {
				await tokenJSON.getNewToken(urlUAA, clientId, clientSecret, userName, userPassword);
			} 
	    	
	    	jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} --- ${commonTools.getLogRow(status,row)}`);
				
			// get Configuration.AI for row tenant
			let predictHost = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'PREDICT_HOST' );
			let predictPort = await dbTools.getParamValue(connectionHDB, row.TENANTID, row.APP_GUID, row.PLATFORM_GUID, 'PREDICT_PORT' );
			let predictUrl = predictPort === '' ? predictHost : predictHost + ':' + predictPort  ;
			
			console.log('--- predictUrl: ', predictUrl)
					
			if (!commonTools.isValidUrl(predictUrl)) {
				jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} URL ( ${predictUrl} ) is not correct.`
					+ `It must begins with "http" or "https" followed by "://" and then any characters other than spaces."`);
			} else {
				// GET request to train/model/status
				console.log('--- tokenJSON.autorization.length: ', tokenJSON.autorization.length)
				let responseJSON = await netTools.getModelStatus(predictUrl, row.MODEL_GUID, false, tokenJSON.autorization);
				
				if (responseJSON.status==401) {
					await tokenJSON.getNewToken(urlUAA, clientId, clientSecret, userName, userPassword);
					responseJSON = await netTools.getModelStatus(predictUrl, row.MODEL_GUID, false, tokenJSON.autorization);
				}
				
				let serverStatus =  responseJSON.SERVER_STATUS;
				console.log('--- SERVER_STATUS : ', serverStatus );
				jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} CODE = ${responseJSON.status} ; SERVER_STATUS = ${serverStatus}`);
				
				if (serverStatus == '4') {
					//Change Model Status to 4 in order to deploy the Model in next Job iteration
					let cnt = await dbTools.setStatusId(connectionHDB, '4', row.TENANTID, row.BOT_GUID, row.MODEL_GUID);
					jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} Updated ${cnt} model into status 4`);
				}
			}
    	}
    }
    
	await connectionHDB.commit();
	jsonObjectOut.Logs.push(`${commonTools.getLogDateString()} STOP`);
	} catch (e) {
		console.error(e);
		await connectionHDB.rollback();
		throw e;
	}

await connectionHDB.close();

$.response.status = $.net.http.OK;
$.response.contentType = "application/json";
$.response.setBody(JSON.stringify(jsonObjectOut));
