This is a chrome extension that you can install, it will show you the best moves on chess.com. The extension popup has some options like elo level & depth.

I went to +2800 elo in bullet with this and 2400 in blitz. Somehow i didnt get banned with this for a very long time, started using this cheat in 2022, forgot about it and played some games for the lolz until i reached 2800 elo. I then got banned tho.

WHY?
Because i can... it's a fun little project if you want to try reading node values in a web app & use the internal functions of web components.

HOW? 
The extension injects a script in chess.com to set an observer on the moves list. When a move is made it reads the FEN position and sends it to the extension back where stockfish can do it's thing.
Once i get the position of the move, i draw an arrow to it using a canvas that was created as overlay on the board component.
