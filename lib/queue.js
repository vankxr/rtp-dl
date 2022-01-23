const { EventEmitter } = require("events");

class Queue extends EventEmitter
{
    constructor(worker, maxConcurrent = 1, lowWaterMark = 1)
    {
        super();

        this._worker = worker;
        this._maxConcurrent = maxConcurrent;
        this._lowWaterMark = lowWaterMark;
        this.tasks = [];
        this.active = 0;
    }

    push(item, cb)
    {
        this.tasks.push(
            {
                item: item,
                cb: cb
            }
        );

        this._next();
    }

    _next()
    {
        if(this.active >= this._maxConcurrent || !this.tasks.length)
            return;

        const task = this.tasks.shift();

        let done = false;

        this.active++;

        this.emit("start", task.item);

        if(this.tasks.length <= this._lowWaterMark)
            this.emit("lowWaterMark");

        this._worker(
            task.item,
            function (e, res)
            {
                if(done)
                    return;

                done = true;

                if(task.cb)
                    task.cb(e, res);

                this.active--;

                if(this.tasks.length)
                    this._next();
                else
                    this.emit("end");
            }.bind(this)
        );
    }

    kill()
    {
        this.tasks = [];
    }
}

module.exports = Queue;