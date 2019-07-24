'use strict';

const {
    smarthome
} = require('actions-on-google');
const functions = require('firebase-functions');
const util = require('util');
const Promise = require('bluebird');
const UUID = require('uuid');
const jwt = require('jsonwebtoken');
const request = require('request');

const myConfig = require('./config.json');

const {
    protocol,
    host,
    port
} = myConfig.server;
const {
    authClientId,
    authClientSecret,
    authRedirectUrl
} = myConfig.auth;
const {
    projectId
} = myConfig.project;


const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
// const appAdmin = admin.initializeApp({
//     credential: admin.credential.applicationDefault()
// });
const db = admin.firestore();


const oauthRedirectUrl = 'https://oauth-redirect.googleusercontent.com/r/';

//
const secretOrPrivateKey = "b9e36e40-8282-11e9-86d9-670f31e2ab44";

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_Forbidden = 403;

//------------------------------------------
exports.auth = functions.https.onRequest((request, response) => {
    const redirectUri = decodeURIComponent(request.query.redirect_uri);
    const state = request.query.state;

    const responseUrl = util.format('%s?state_str=%s',
        authRedirectUrl, state);

    console.log(`auth redirect responseUrl--->${responseUrl}`);
    return response.redirect(responseUrl);
});

exports.code = functions.https.onRequest((request, response) => {
    let email = request.query.userName;
    getCode(email).then((code) => {
        const responseUrl = util.format('%s?code=%s&state=%s',
            oauthRedirectUrl + projectId, code,
            request.query.state_str);
        console.log(responseUrl);
        return response.redirect(responseUrl);
    }).catch((err) => {
        return response.status(HTTP_STATUS_Forbidden);
    });
});

exports.token = functions.https.onRequest((request, response) => {
    const grantType = request.query.grant_type ?
        request.query.grant_type : request.body.grant_type;
    const secondsInDay = 86400; // 60 * 60 * 24

    let obj;
    if (grantType === 'authorization_code') {
        const code = request.body.code;

        getToken(code).then((data) => {
            if (data.status === 1) {
                obj = {
                    token_type: 'bearer',
                    access_token: data.accessToken,
                    refresh_token: data.refreshToken,
                    expires_in: secondsInDay,
                };
                console.log(`getToken response-->${JSON.stringify(obj)}`);
                response.status(HTTP_STATUS_OK)
                    .json(obj);
            } else {
                response.status(HTTP_STATUS_Forbidden);
            }
        });
    } else if (grantType === 'refresh_token') {
        const refresh_token = request.body.refresh_token;
        const client_id = request.body.client_id;
        const client_secret = request.body.client_secret;
        if (client_id === authClientId && client_secret === authClientSecret) {
            refreshToken(refresh_token).then((data) => {
                if (data.status === 1) {
                    obj = {
                        token_type: 'bearer',
                        access_token: data.accessToken,
                        expires_in: secondsInDay,
                    };
                    response.status(HTTP_STATUS_OK)
                        .json(obj);
                } else {
                    response.status(HTTP_STATUS_Forbidden);
                }
            })
        } else {
            response.status(HTTP_STATUS_Forbidden);
        }
    }
});

const app = smarthome({
    debug: true
});

app.onSync(async (body, headers) => {
    const token = headers.authorization.split('Bearer ')[1];
    try {
        const data = await getUserNameByToken(token);
        if (data.status === 1) {
            let devicesList = await getDeviceListsByRequest(data.userName, '/googlesmart');
            let devices = processGoogleDeviceList(devicesList);
            if (devices.length === 0) {
                // return;
            }
            return {
                requestId: body.requestId,
                payload: {
                    agentUserId: data.uid,
                    devices: devices
                }
            }
        } else {
            console.log(`getUserNameByToken data:${JSON.stringify(data)}`)
        }
    } catch (err) {}
});

app.onExecute(async (body, headers) => {
    console.log(`onExecute body:${JSON.stringify(body)} headers:${JSON.stringify(headers)}`);
    //action.devices.commands.GetCameraStream
    const deviceId = body.inputs[0].payload.commands[0].devices[0].id;
    console.log(`onExecute deviceId:${deviceId}`);    
    const uri = await getUriByRequest(deviceId, '/googlesmart');
    console.log(`onExecute getUriByRequest:${uri}`);
    if (uri !== '') {
        return {
            requestId: body.requestId,
            payload: {
                commands: [{
                    ids: [deviceId],
                    status: 'SUCCESS',
                    states: {
                        cameraStreamAccessUrl: uri,
                        cameraStreamReceiverAppId: '',
                        cameraStreamAuthToken: ''
                    }
                }]
            }
        };
    } else {}
});

app.onDisconnect((body, headers) => {
    console.log(`onExecute body:${JSON.stringify(body)} headers:${JSON.stringify(headers)}`);
    // TODO Disconnect user account from Google Assistant
    // You can return an empty body
    return {};
});

exports.smarthome = functions.https.onRequest(app);

function getCode(userName) {
    const code = UUID.v1();
    return new Promise((resolve, reject) => {
        db.collection('authList').where('user_account', '==', userName)
            .get()
            .then((snapshot) => {
                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        db.collection('authList').doc(doc.data().code).delete()
                    });
                }
                var docRef = db.collection('authList').doc(code);

                var setAda = docRef.set({
                    user_account: userName,
                    code: code,
                    accessToken: '',
                    refreshToken: ''
                }).then((result) => {
                    resolve(code);
                });

            })
    });
}

function getToken(code) {
    return new Promise((resolve, reject) => {
        var query = db.collection('authList').where('code', '==', code)
            .get()
            .then(snapshot => {
                if (!snapshot.empty) {
                    let content = {
                        code: code
                    };
                    let refreshToken = jwt.sign(content, secretOrPrivateKey, {
                        expiresIn: 60 * 60 * 24 * 365 // 1 year
                    });
                    let contentToken = {
                        token: refreshToken
                    };
                    let accessToken = jwt.sign(contentToken, secretOrPrivateKey, {
                        expiresIn: 60 * 60 * 24 // 24 hours
                    });

                    var docRef = db.collection('authList').doc(code);

                    var setAda = docRef.update({
                        accessToken: accessToken,
                        refreshToken: refreshToken
                    }).then(() => {
                        resolve({
                            status: 1,
                            accessToken: accessToken,
                            refreshToken: refreshToken
                        });
                    });
                }
            })
            .catch(err => {
                console.log('Error getting documents', err);
                reject({
                    status: 2
                });
            });
    });
}

function refreshToken(refreshToken) {
    return new Promise((resolve, reject) => {
        var query = db.collection('authList').where('refreshToken', '==', refreshToken)
            .get().then((snapshot) => {
                if (!snapshot.empty) {
                    let accessToken, refreshToken;
                    snapshot.forEach(doc => {
                        accessToken = doc.data().accessToken;
                        refreshToken = doc.data().refreshToken;
                    });
                    resolve({
                        status: 1,
                        accessToken: accessToken,
                        refreshToken: refreshToken
                    });
                }
            })
    });
}

function getUserNameByToken(token) {
    return new Promise((resolve, reject) => {
        var query = db.collection('authList').where('accessToken', '==', token)
            .get().then((snapshot) => {
                if (!snapshot.empty) {
                    let userName, uid;
                    snapshot.forEach(doc => {
                        userName = doc.data().user_account;
                        uid = doc.data().code;
                    });
                    resolve({
                        status: 1,
                        userName: userName,
                        uid: uid
                    });
                }
            })
    });
}

function getDeviceListsByRequest(email, path) {
    var requestData = {};
    requestData.command = "getDevices";
    requestData.userName = email;
    return new Promise(function (resolve, reject) {
        request.post({
            url: `${protocol}://${host}:${port}${path}`,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(requestData)
        }, function (error, response, body) {
            if (error) {
                console.log(`getDeviceListsByRequest error:${JSON.stringify(error)}`)
                reject([]);
            }
            if (!error && response.statusCode === 200) {
                let dataObj = JSON.parse(body);
                if (Number(dataObj.status) === 1) {
                    resolve(dataObj.data.deviceList);
                } else {
                    resolve([]);
                }
            }
        });
    });
}

function processGoogleDeviceList(deviceList) {
    let devices = [];
    if (!Array.isArray(deviceList) || deviceList.length === 0) {
        return devices;
    }
    for (let index in deviceList) {
        let device = getDevice();
        device.id = deviceList[index].endpointId;
        let channelName = deviceList[index].channelName;
        device.name.name = channelName;
        device.name.nicknames.push(channelName);
        device.customData.chn = deviceList[index].chn;
        devices.push(device);
    }
    return devices;
}

function getDevice() {
    return {
        id: '123',
        type: 'action.devices.types.CAMERA',
        traits: [
            'action.devices.traits.CameraStream'
        ],
        name: {
            defaultNames: ['Smart Camera'],
            name: 'Smart Camera',
            nicknames: []
        },
        willReportState: false,
        attributes: {
            cameraStreamSupportedProtocols: ['hls', 'dash'],
            cameraStreamNeedAuthToken: true,
            cameraStreamNeedDrmEncryption: false
        },
        customData: {
            chn: 0
        }
    }
}

function getUriByRequest(uid, path) {
    var requestData = {};
    requestData.command = "getUri";
    requestData.uid = uid;
    return new Promise(function (resolve, reject) {
        request.post({
            url: `${protocol}://${host}:${port}${path}`,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(requestData)
        }, function (error, response, body) {
            if (error) {
                resolve('');
            }
            if (!error && response.statusCode === 200) {
                let dataObj = JSON.parse(body);
                if (Number(dataObj.status) === 1) {
                    resolve(dataObj.data.uri);
                } else {
                    resolve('');
                }
            }
        });
    });
}