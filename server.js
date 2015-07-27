var express = require('express');
var fs = require('fs');
var app = express();
var bodyParser = require('body-parser');
var requestify = require('requestify');
var deasync = require('deasync');
var moduleVars = require('./moduleVars');

// for parsing application/json
app.use(bodyParser.json()); 

//connect static links
app.use('/js', express.static(__dirname + '/frontEnd/js'));
app.use('/css', express.static(__dirname + '/frontEnd/css'));
app.use(express.static(__dirname + '/includes'));


/*********************/
/* HTTP GET HANDLING */
/*********************/
app.get('/', function (req, res) {
	//Proof of concept utilizing exam module. Change to or include info/usage page?
 	res.sendFile( __dirname + "/frontEnd/" );
});

app.get('/includes/css/include.css', function (req, res) {
 	res.sendFile( __dirname + "/includes/css/include.css" );
});

app.get('/upload/', function (req, res) {
 	res.sendFile( __dirname + "/frontEnd/data_upload/upload.html" );
});


  /*************************/
 /* Routing (Controllers) */
/*************************/
//handle post request to retrieve datafiles
app.post('/getModule', function (req, res) {
	getDataFile(req, res, serveModule);
});

//handle api compile requests
app.post('/compile', function (req, res) {
	compile(req.body, res, "post");
});
 
//handle answer submits answers for grading
app.post('/submit', function (req, res) {
	//console.log(req.body);
	getDataFile(req, res, processExam);
});

app.post('/data_upload', function (req, res) {
	//TODO: handle file posting/uploading
});

//start server
var server = app.listen(8888, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log('[%s] Server listening at http://%s:%s',  __dirname, host, port);
});


/**************/
/* Functions */
/************/
//Get specified datafile
function getDataFile(req, res, callback)
{
	var file = __dirname + '/dataFiles/data' + req.body.test_id + '.json';
	var data = { result: "Server file load error!"};

	fs.readFile(file, 'utf8', function (err, datafile) {
		if (err) {
			console.log('E: ' + err);
			return;
		}
		if(callback == "processExam")
			wait.launchFiber(processExam);
		else
			callback(req, res, JSON.parse(datafile));
	});
}

function serveModule(req, res, data)
{
	var html = "";

	//get exported template data from moduleVars.js
	var header = moduleVars.header; //Overall page header information/instructions
	var requires = moduleVars.requires; //all css/js/etc. includes
	var pStatementTemplate = moduleVars.pStatementTemplate; //problemstatement template structure. Has placeholders to be changed in forloop below.
	
	//programming specific template vars
	var ioTemplate = moduleVars.ioTemplate; //code and input template structure. Has placeholders to be changed in forloop below.
	var navTemplate = moduleVars.navTemplate; //template that holds the nav elements used to switch between exam questions
	
	//multChoice specific template vars
	var mcCodeTemplate = moduleVars.mcCodeTemplate; //template that holds code editor for mchoice questions
	var mcOptionTemplate = moduleVars.mcOptionTemplate; //template that holds the skeleton for each mchoice option
	var mcClose = moduleVars.mcClose; // closes div tags that could not be closed until multiple iterations had been inserted.
	
	//script to be evald on client side
	var editorInit = moduleVars.editorInit; //function call to be appended per editor instance to init
	var script = moduleVars.script; //all listeners and js code to be evald once client has received

	//Decide which module to serve
	if(req.body.type == 'exam')
	{
		html = '<!--BEGIN module code-->' + requires + header;

		//iterate through each question in exam datafile, replacing placeholders with index and datafile specefied information
		for(var i = 0; i < Object.keys(data).length; i++)
		{
			//default to python, else adjust accordingly. Add options as needed.
			var lang = "python"
			if(data[i]["language"].toUpperCase() == "C" || data[i]["language"].toUpperCase() == "C++" || data[i]["language"].toUpperCase() == "C#")
				lang = "clike";

			//if question type is a programming question (type: "code")
			if(data[i]["questionType"] == "code")
			{
				html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + ioTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, data[i]["skeleton"]);
				
				script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, lang);
			}
			//if question type is a programming question (type: "mchoice")
			else if(data[i]["questionType"] == "mchoice")
			{
				html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + mcCodeTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, data[i]["skeleton"]);;
				script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, lang);

				//iterate through each multiple choice supplied in the datafile per question
				for(var j = 0; j < data[i]["input"].length; j++)
				{
					//TODO: MOVE THIS TO MODULE VARS!!
					html += "<div class='mcSubQ'><b>" + data[i]["input"][j][0] + "</b><br/>";
					for(var k = 0; k < data[i]["input"][0][1].length; k++)
					{
						html += mcOptionTemplate.replace(/<<mc>>/g, data[i]["input"][j][1][k]).replace(/<<o>>/g, k).replace(/<<n>>/g, i + "_" + j);
					}
					html += "</div>";
				}

				html += mcClose;
			}	
		}

		html += navTemplate + '<!--END module code-->';
	}
	else if(req.body.type == 'book')
	{
		//TODO: proof of concept code for book module
	}

	//send object
	res.type('json');
	res.send( {response_html : html, response_script: script} );
}

function processExam(req, res, data)
{
	console.log("processing...");
	//Track points, score, and results
	var totalPoints =0;
	var subTotalPoints = 0;
	var studentScore = 0;
	var subStudentScore = 0;
	var resultFile = "";

	for(var i = 0; i < Object.keys(data).length; i++)
	{
		//reset subtotal points, print next question label
		subTotalPoints = 0;
		subStudentScore = 0;
		resultFile += "****** Question " + i + ", type: " + req.body.problemType[i] + " ******\n\n";


		if(req.body.problemType[i] == "code")
		{
			//Track points and student score
			subTotalPoints += parseInt(data[i]["points"][0]);
			totalPoints += subTotalPoints;

			//By default assume python(v3), change only if different. Add options as needed.
			var args = "";
			var wrapper = "24";
			if(data[i]["language"].toUpperCase() == "C++")
			{
				args = "-std=c++14 -o a.out source_file.cpp";
				wrapper = "7";
			}


			resultFile += "Submitted code:\n------------------------------------------\n\n" + req.body.solution[i] + "\n\n";

			for(var j = 0; j < data[i]['input'].length; j++)
			{
				//User's data
				var userData = {
					"LanguageChoiceWrapper": wrapper,
					"Program": req.body.solution[i], //user defined code
					"input": data[i]['input'][j], //datafile defined testcase
					"compilerArgs": args
				};

				//TEMPORARY! - global variables due to node requring asynch, and we need synch due to temp external soap api. This will all change anyway, so use ugly globals for now here...
				done = false;
				compileResult = [];
				compile(userData);

				//TEMPORARY! - wait 1sec. until compile completes. Temp solution as we are temp. using an external soap api service at the point.
				while(done == false) {
				    require('deasync').sleep(500);
				  }

				resultFile += "\n------------------------------------------\n\nTest Input: " + data[i]['input'][j] + "\nCorrect output: " + data[i]['output'][j] + "\nReceived output: " + compileResult.Result + "\n\n";

				if(data[i]['output'][j] == compileResult.Result)
				{
					subStudentScore += parseInt(data[i]["points"][j]);
					studentScore += subStudentScore;
					resultFile += "status: correct\n";
				} else
					resultFile += "status: incorrect\n";

				//result = compile(userData);
				//console.log(i, "continued");
			}
			

		//On exam finish (part one): 
		//receive committed codes via post
		//read in datafile via fs
		//loop per question -> per test case to determine score
		//write to file

		}else if(req.body.problemType[i] == "mchoice")
		{
			for(var j = 0; j < data[i]["input"].length; j++)
			{
				//console.log("comparing: ", req.body.solution[i][j], data[i]['output'][j])

				//Record input
				var correctIndex = parseInt(data[i]['output'][j]);
				var submittedIndex = parseInt(req.body.solution[i][j]);
				resultFile += "Correct answer: " + data[i]['input'][j][1][correctIndex] + "\nReceived answer: " + data[i]['input'][j][1][submittedIndex] + "\n state: ";

				//Track points and student score
				subTotalPoints += parseInt(data[i]["points"][j]);
				totalPoints += subTotalPoints;
				if(req.body.solution[i][j] == data[i]['output'][j])
				{
					subStudentScore += parseInt(data[i]["points"][j]);
					studentScore += subStudentScore;
					resultFile += "Correct\n\n";
				} else
					resultFile += "Inorrect\n\n";
			}
		}
		resultFile += "\nQuestion sub-score: " + subStudentScore + "/" + subTotalPoints + "\n====================================================\n\n\n\n";
	}
	resultFile += "\nFINAL SCORE: " + parseInt(studentScore) + "/" + parseInt(totalPoints) + "\n";

	//formulate path, create directory if necessary
	var path = __dirname + '/testResults/test' + req.body.test_id + '/';
	try {
	    fs.mkdirSync(path);
	  } catch(e) {
	    if ( e.code != 'EEXIST' ) 
	    	throw e;
	  }

	//Write results to file
	fs.writeFile(path + req.body.idNum + '.txt', resultFile, function(err) {
	    if(err) {
	        return console.log(err);
	    }
	    console.log("The file was saved!");
	});

	res.type('json');  
	res.send({status : "ok"});
}

function compile(data, res, type){
	//temporarily compiling via external call to api. Later on will be doing this ourselves by writing to file and executing on vm.
	requestify.post('http://rextester.com/rundotnet/api', data)
    .then(function(response) {
        response.getBody();
        if(type == "post")
        {
        	res.type('json');
	  		res.send(response.body);
        }else 
        {
        	done = true;
        	compileResult = JSON.parse(response.body);
        }
    });
}