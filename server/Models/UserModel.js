const md5 = require('md5')
const nodemailer = require('nodemailer')
const MySQL_db = (require('../utils/db')).MySQL_db
const Redis_db = (require('../utils/db')).Redis_db
const domain = require('../config/Domain-config')
const Neo4j_db = (require('../utils/db')).Neo4j_db
const randomNos = require('../utils/randomNos')


class UserModel {
	static async username(username) {
		let sql = `select * from user where username = '${username}'`
		let data = await MySQL_db(sql)
		if(data.length != 0) {
			return true
		} 
		return false
	}

	static async signup(username, password, email) {
		let sql = `insert into user (username, password, email) values ('${username}', '${password}', '${email}')`
		await MySQL_db(sql)
		let cypher = `create(user:User{username:'${username}'})`
		await Neo4j_db(cypher)
	}

	static async signin(username, password) {
		let sql = `select * from user where username = '${username}' and password = '${password}'`
		let data = await MySQL_db(sql)
		if(data.length === 0) {
			return false
		}
		return true
	}

	static async retrieve(username) {
		let sql = `select username, email from user where username = '${username}'`
		let email = (await MySQL_db(sql))[0].email
		let token = md5(username + (new Date()).toLocaleString() + Math.random())
		
		var params = {
		    host: 'smtp.163.com',
		    port: 465,
		    sercure: true,
		    auth: {
		        user: '18365225454@163.com',
		        pass: 'yetiandi123'
		    }
		} 

		const transporter = nodemailer.createTransport(params)

		const mailOptions = {
	        from: '18365225454@163.com', 
	        to: email, 
	        subject: '叶鲜生生鲜超市找回密码', 
	        html: `<a href='http://${domain}:8000/#/reset?token=${token}'><b>请在五分钟内点击链接完成验证，并进行密码重置</b></a>` 
	    }

	    await transporter.sendMail(mailOptions, async function(err, info) {

	        if (err) { return console.log(err) }
	        await Redis_db.set(token, username);
	        await Redis_db.expire(token, 300);
	        console.log(`Emial sent to ${username}: ${email} sent successfully!`); 
	    })

	    return 
	}

	static async reset(token, password) {
		let response = await Redis_db.exists(token)
		var msg = ''

		if(response === 1) {

			let username = await Redis_db.get(token)

			let sql = `update user set password = '${password}' where username = '${username}'`
			await MySQL_db(sql)
			await Redis_db.del(token)
			msg = '密码重置成功！'
			
		} else if(response === 0){

			msg = '邮箱验证链接已经过期！'
		} 
		return msg
	}

	static async address(username) {
		let sql = `select * from address where username = '${username}' order by isdefault desc`
		let data = await MySQL_db(sql)
		return data
	}

	static async insertAddress(username, province, city, county, street, addressname, default_) {
		let sql = `insert into address (username, province, city, county, street, addressname, isdefault) values ('${username}', '${province}', '${city}', '${county}', '${street}', '${addressname}', ${default_})`
		console.log(sql)
		await MySQL_db(sql)
		return 
	}

	static async deleteaddress() {
		let sql = `delete from address where addressNo = '${addressNo}'`
		let data = await MySQL_db(sql)
		let code = 0
		let msg = ''
		if( data.length != 0){
			code = 0
			msg = "删除成功!"
		} else {
			code = -1
			msg = "删除失败!"
		}
		return [code, msg]
	}

	static async buy(goodsList, orderTime, username) {
		let sql = `insert into receive (username, goodsNo, orderNo, num, orderTime, subtotal, address) values `

		for(let i=0; i<goodsList.length; i++) {
			if(i < goodsList.length - 1) {
				sql += `('${username}', '${goodsList[i].goodsNo}', '${md5(username + orderTime + goodsList[i].subtotal)}', '${goodsList[i].num}', '${orderTime}', ${goodsList[i].subtotal}, '${goodsList[i].address}'), `

			} else {
				sql += `('${username}', '${goodsList[i].goodsNo}', '${md5(username + orderTime + goodsList[i].subtotal)}', '${goodsList[i].num}', '${orderTime}', ${goodsList[i].subtotal}, '${goodsList[i].address}');`
			}
		}


		for (let i=0; i<goodsList.length; i++) {

			if(i < goodsList.length - 1) {
				sql += `UPDATE goods SET inventory = inventory - '${goodsList[i].num}' WHERE goodsNo = '${goodsList[i].goodsNo}';`
			} else {
				sql += `UPDATE goods SET inventory = inventory - '${goodsList[i].num}' WHERE goodsNo = '${goodsList[i].goodsNo}'`
			}
		
		}

		await MySQL_db(sql)
		
		let cypher = `match(user:User{username: '${username}'}),`

		for(let j=0; j<goodsList.length; j++) {
			let node_name = '_' + j 
			if(j < goodsList.length - 1) {
				cypher += `(${node_name}:Goods{goodsNo:${goodsList[j].goodsNo}}),`
			} else {
				cypher += `(${node_name}:Goods{goodsNo:${goodsList[j].goodsNo}})`
			}
		}

		cypher += `create`

		for(let i=0; i<goodsList.length; i++) {
			let node_name = '_' + i
			if(i < goodsList.length - 1) {
				cypher += `(user)-[:Buy{num:${goodsList[i].num}}]->(${node_name}), `
			} else {
				cypher += `(user)-[:Buy{num:${goodsList[i].num}}]->(${node_name})`
			}
			
		}

		await Neo4j_db(cypher)

		return 
	}

	static async fav(username) {
		/*每次推荐五个商品，类别未做限制*/
		let cypher = `match p=(host:User)-[:SimilarTo|Buy*1..6]-(pg:Goods)
	                    where host.username = '${username}'
	                    and not (host)-[:Buy]->(pg)
	                    return pg.goodsNo as goodsNo
	                    limit 5`

	    let goodsList = (await Neo4j_db(cypher)).data

	    if(goodsList.length != 5) {
	    	cypher = `match (goods:Goods)
	    				return count(goods) as goodsCount`

	    	let max = (await Neo4j_db(cypher)).data[0]

	    	goodsList = randomNos(goodsList, 5, max) 

	    }

	    let sql = `select goodsNo, goodsName, type, subtype, price, inventory, validity, description from goods where goodsNo in (${goodsList[0]}, ${goodsList[1]}, ${goodsList[2]}, ${goodsList[3]}, ${goodsList[4]})`

	    let data = await MySQL_db(sql)
	    return data
	}
}

module.exports = UserModel