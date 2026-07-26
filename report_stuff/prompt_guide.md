Your task is to generate a comprehensive report about the entire project. read report_stuff/report_guide.md to understand the structure, use the latex skill as we want our report to be in a pdf format but written in latex for better visuals and structures.

0) Why we made this project: its a collaborative text editor that can work on LAN and global wifi both. one of the problems it solves is enables easier collaborative editing in classrooms, when sometimes we couldnt use screen sharing due to internet issues and we had to use the professors laptop for students to participate in seminars, our project solves this with its decentralized peer to peer protocol which can work on LAN and global networks both. 

1) Make an introduction about collaborative text editing and major algorithms. then explain why we chose CRDT (YATA improvement) and explain what problem it solves. explain how our algorithms are inspired by YJS implementations of the YATA algorithm. explain why we use cloudflare tunnel.

2) explain the overall architecture of the system: the hub-and-spoke gateway, hosts and guests, read-only and write-only guests. explain the tauri framework conceptually (not in detail for now). briefly talk about our frontend (how we use monaco editor as a skeleton)

report design during writing report, visual side (apply these graphs to appropriate sections) : 
  1. one graph for the overall architecture (visualise the gateway running on the hosts machine and all the clients)
  2. one graph that shows all layers of the client tauri app: document actor, garbage collection system, process spawning system, state vector exchange system, permission management system, file-saver, app-state management and websocket management
  3. one graph that visualizes CRDT document data structure (including the linked list and the btree index). create an animation that shows an insertion and deletion of a block from the crdt document borht with original linked list and positional b-tree insertion/deletion. 

3)  As you know we have 3 tier architecture so  we need to go into detail for each one
    1. the CRDT-core library. explain the core entities, the document linked list, the b-tree position index. explain why the position index was needed and why the position finding is slow without the optimization. explain the block splitting, explain how delete set works and how commit delete works and the state vector
    2. explain the tauri application. its core components, the abstraction layers, explain how it sends changes to frontend with ipc, how it spawns processes, how it uses tokio for asynchronous tasks, how it uses document actor design patterns, how it uses websocket protocol for communication, explain the garbage collection system, file saving, session management, permission management system. explain how the metrics system works
    3. frontend. explain how it communicates with backend, how it uses react and all features idk i have no idea how it works
    4. gateway. explain its role as the dumb relay server running on the hosts machine as process spawned by tauri. explain the core entities: room, hub, clients, relaying logic, websocket protocol, metrics.

4) explain how we optimized the system by implememnting the btree position index and the garbage collection system, explain why its important in yjs. explain that our garbage collection system is unique from other GC systems in CRDT implementations because of the property of the system where the source of truth is the Host himself and its not a pure p2p system. 

5) sources : 
    yata original paper
    string split inspiration from yjs : https://docs.yjs.dev/
    for b-tree optimisation inspo : https://github.com/josephg/diamond-types 
    claude for frontend design : D 

wegan ro vixmuret ro ro sheetenot da mere civi chamoio
uuh
bruh. 
ubralod xiooba situaciaa xvalamde morigdebian idk

sanarskis im ortan dzaan arunda ro tqvas ro hseetena
mara verc iazrebs ro is ori arc ejibreba