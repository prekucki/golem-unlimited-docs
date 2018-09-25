
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

var app = angular.module('gu', ['ui.bootstrap', 'angularjs-gauge'])
  .controller('AppController', function($scope, pluginManager) {
      $scope.tabs = [
        {icon: 'glyphicon glyphicon-home', name: 'Status', page: 'status.html'},
        {icon: 'glyphicon glyphicon-th', name: 'Providers', page: 'providers.html'}
      ];
      $scope.pluginTabs = pluginManager.getTabs();
      $scope.activeTab =  $scope.tabs[0];

      $scope.openTab = tab => {
        $scope.activeTab = tab;
      }
  })
  .controller('ProvidersController', function($scope, $http, $uibModal, hubApi, sessionMan) {

     $scope.refresh = function refresh() {
        sessionMan.peers(null, true).then(peers => $scope.peers = peers)
     }


     $scope.show = function(peer) {
        $uibModal.open({
            animate: true,
            templateUrl: 'hdsession.html',
            controller: function($scope, $uibModalInstance) {
                peer.refreshSessions();
                $scope.peer = peer;
                $scope.ok = function() {
                    $uibModalInstance.close()
                }
                $scope.destroySession = function(peer, session) {
                    session.destroy();
                    peer.refreshSessions();
                }
            }
        })
     }

     $scope.peers = [];
     $scope.refresh();

  })
  .controller('StatusController', function($scope, $http) {
     function refresh() {
        $http.post('/m/19354', "null").then(r => {
            var ok = r.data.Ok;
            if (ok) {
                $scope.hub = ok
            }
        });
        $http.get('/peer').then(r => {
            $scope.peers = r.data;
        });
     };

     $scope.refresh = refresh;

     $scope.hub = {};
     refresh();

  })
  .service('hubApi', function($http) {
        function callRemote(nodeId, destinationId, body) {
            return $http.post('/peer/send-to/' + nodeId + '/' + destinationId, {b: body}).then(r => r.data);
        }

        return { callRemote: callRemote};
  })
  .service('pluginManager', function($log) {
        var plugins = [];

        function addTab(desc) {
            $log.info('add', desc);
            plugins.push(desc)
        }

        function getTabs() {
            $log.info('get')
            return plugins;
        }

        return {addTab: addTab, getTabs: getTabs}
  })
  .service('sessionMan', function($http, $log, hubApi, hdMan) {
        var sessions = [];
        if ('gu:sessions' in window.localStorage) {
            sessions = JSON.parse(window.localStorage.getItem('gu:sessions'));
        }

        function save(newSessions) {
            if (angular.isArray(newSessions)) {
                sessions = newSessions;
            }
            $log.info('save', sessions);
            window.localStorage.setItem('gu:sessions', JSON.stringify(sessions));
        }

        function cleanPeer(peer) {
            return {nodeId: peer.nodeId};
        }

        function cleanPeers(inPeers) {
            var peers = [];
            angular.forEach(inPeers, peer => peers.push(cleanPeer(peer)));

            return peers;
        }

        function updateSession(moduleSession, newStatus, updates) {
            $log.info('updateSession', moduleSession, newStatus, updates);
            angular.forEach(sessions, session => {
                if (session.id === moduleSession.id) {
                    if (updates.peers) {
                        session.peers = cleanPeers(updates.peers);
                    }
                    session.status = newStatus;
                    angular.copy(session, moduleSession);
                }
            });
            save();
        }

        function dropSession(moduleSession) {
            $log.info("drop", moduleSession);
            save(_.reject(sessions, session => session.id === moduleSession.id));
        }

        function create(sessionType, env) {
            var session = {
                id: guid(),
                type: sessionType,
                env: env,
                status: 'NEW'
            };
            sessions.push(session);
            save();
        }

        function send(node_id) {
            return function(destination, body) {
                return $http.post('/peer/send-to', [node_id, destination, body]).then(r => r.data);
            }
        }

        function peers(session, needDetails) {
            var peersPromise = $http.get('/peer').then(r => r.data);

            if (needDetails) {
                peersPromise.then(peers => angular.forEach(peers, peer => peerDetails(peer)));
            }

            return peersPromise;
        }

        function peerDetails(peer) {
            hubApi.callRemote(peer.nodeId, 19354, null).then(data=> {
                var ok = data.Ok;
                if (ok) {
                    peer.ram = ok.ram;
                    peer.gpu = ok.gpu;
                    peer.os = ok.os || peer.os;
                    peer.hostname = ok.hostname;
                }
            });

            peer.hdMan = hdMan.peer(peer.nodeId);
            peer.refreshSessions = function() {
                peer.hdMan.sessions().then(sessions => peer.sessions = sessions);
            }

            peer.refreshSessions();
        };


        function listSessions(sessionType) {
            var s = [];

            angular.forEach(sessions, session => {
                if (sessionType === session.type) {
                    var sessionDto = angular.copy(session);
                    sessionDto.send = send(session.nodeId);
                    s.push(sessionDto);
                }
            });
            return s;
        }

        return {
            create: create,
            peers: peers,
            sessions: listSessions,
            peerDetails: peerDetails,
            updateSession: updateSession,
            dropSession: dropSession
         }
  })
  .service('hdMan', function($http, hubApi, $q, $log) {
        var cache = {};

        const HDMAN_CREATE = 37;
        const HDMAN_UPDATE = 38;
        const HDMAN_GET_SESSIONS = 39;
        const HDMAN_DESTROY = 40;

        class HdMan {
            constructor(nodeId) {
                this.nodeId = nodeId;
            }

            newSession(sessionSpec) {
                return new Session(this.nodeId,
                    hubApi.callRemote(this.nodeId, HDMAN_CREATE, sessionSpec));
            }

            fromId(sessionId, sessionData) {
                return new Session(this.nodeId, {Ok: sessionId}, sessionData);
            }

            sessions() {
                return hubApi.callRemote(this.nodeId, HDMAN_GET_SESSIONS, {})
                    .then(sessions => {
                        var sessions = _.map(sessions.Ok, session => this.fromId(session.id, session));
                        cache[this.nodeId] = sessions;
                        return sessions;
                    })
            }

            sessionsFast() {
            // TODO: FIXME
//                if (this.nodeId in cache) {
//                    $log.debug("sessionFast: cache used", $q.when(cache[this.nodeId]), this.sessions())
//                    return $q.when(cache[this.nodeId]);
//                }
//                $log.debug("sessionFast: cache not used", this.sessions())
                return this.sessions();
            }
        }

        class Session {
            constructor(nodeId, sessionId, sessionData) {
                this.nodeId = nodeId;
                this.status = 'PENDING';
                this.data = sessionData;
                this.$create = $q.when(sessionId).then(id => {
                    if (id.Ok) {
                        this.id = id.Ok;
                        this.status = 'CREATED';
                        return id.Ok;
                    }
                    else {
                        $log.error('create session fail', id);
                        this.status = 'FAIL';
                        return null;
                    }
                });
            }

            exec(entry, args) {
                return this.$create.then(id =>
                    hubApi.callRemote(this.nodeId, HDMAN_UPDATE, {
                        session_id: id,
                        commands: [
                            {Exec: {executable: entry, args: (args||[])}}
                        ]
                    })
                ).then(result => {
                    $log.info("exec result", result);
                    return result;
                });
            }

            destroy() {
                return hubApi.callRemote(this.nodeId, HDMAN_DESTROY, {session_id : this.id}).then(result => {
                    if (result.Ok) {
                        $log.info("session", this.id, "closed: ", result);
                    } else {
                        $log.error("session", this.id, "closing error:", result);
                    }
                    return result;
                });
            }
        }

        function peer(nodeId) {
            return new HdMan(nodeId);
        }

        return { peer: peer }
  });
